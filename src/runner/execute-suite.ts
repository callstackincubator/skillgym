import path from "node:path";
import process from "node:process";
import os from "node:os";
import { getCaseExecutionOptions } from "../config.js";
import type {
  CaseResult,
  RepetitionResult,
  RunnerSessionResult,
  RunnerResult,
  RunnerSummary,
  SuiteRunResult,
} from "../domain/result.js";
import type { ResolvedRunner, RunnerConfig, RunnerInfo } from "../domain/runner.js";
import type { ScheduleMode } from "../domain/schedule.js";
import type { Case, SuiteWorkspaceConfig } from "../domain/case.js";
import { getAdapter } from "../adapters/index.js";
import { normalizeFailureClass } from "../failure-classification.js";
import type { BenchmarkReporter, ReporterContext } from "../reporters/contract.js";
import { SnapshotStore, type SnapshotRuntimeOptions } from "../snapshots/store.js";
import { ensureDir, writeJson } from "../utils/fs.js";
import { average, nowIso } from "../utils/time.js";
import { createRunnerInfo } from "./runner-info.js";
import { executeRunner } from "./execute-runner.js";
import { isModelRejectedResult } from "./model-rejection.js";
import { scheduleExecutions, type PlannedExecution } from "./scheduler.js";
import {
  createExecutionFailureResult,
  finalizeWorkspace,
  getSharedWorkspacePath,
  prepareWorkspace,
  prepareSharedWorkspace,
  resolveEffectiveWorkspace,
  writeExecutionWorkspaceMetadata,
} from "./workspace.js";

interface PlannedSuiteExecution {
  case: Case;
  runner: ResolvedRunner;
  caseIndex: number;
  runnerIndex: number;
  timeoutMs: number;
}

interface PlannedCaseResult {
  case: Case;
  runnerResults: Array<RunnerResult | undefined>;
}

interface PlannedCaseState {
  started: boolean;
  completedExecutions: number;
}

export async function executeSuite(
  suitePath: string,
  cases: Case[],
  options: {
    cwd: string;
    outputDir?: string;
    suiteRunArtifactDir?: string;
    schedule?: ScheduleMode;
    maxParallel?: number;
    repeat?: number;
    repeatFailure?: number;
    retryFailed?: number;
    caseId?: string;
    runner?: string;
    tags?: string[];
    config: {
      defaults?: {
        timeoutMs?: number;
      };
      run?: {
        workspace?: SuiteWorkspaceConfig;
        maxSteps?: number;
        repeat?: number;
        repeatFailure?: number;
        retryFailed?: number;
        tags?: string[];
      };
      runners: Record<string, RunnerConfig>;
    };
    suiteWorkspace?: SuiteWorkspaceConfig;
    snapshots?: SnapshotRuntimeOptions;
    reporter?: BenchmarkReporter;
    isInteractive?: boolean;
    executeRunnerFn?: typeof executeRunner;
  },
): Promise<SuiteRunResult> {
  const startedAt = nowIso();
  const startedMs = Date.now();
  const resolvedSuitePath = path.resolve(suitePath);
  const outputDir =
    options.suiteRunArtifactDir === undefined
      ? path.resolve(options.outputDir ?? ".skillgym-results", timestampDirName())
      : path.resolve(options.suiteRunArtifactDir);
  const scheduleMode = options.schedule ?? "serial";
  const maxParallel = resolveMaxParallel(scheduleMode, options.maxParallel);
  const repeat = options.repeat ?? options.config.run?.repeat ?? 1;
  const repeatFailure =
    options.repeatFailure ??
    options.retryFailed ??
    options.config.run?.repeatFailure ??
    options.config.run?.retryFailed ??
    0;
  await ensureDir(outputDir);
  const selectedRunners = selectRunners(options.config.runners, options.runner);
  const normalizedCases = normalizeCases(cases);
  const declaredTags = collectDeclaredTags(normalizedCases);
  const selectedTags = normalizeTags(options.tags ?? options.config.run?.tags, "tag filters");
  const resolvedWorkspace = resolveEffectiveWorkspace({
    baseCwd: options.cwd,
    suiteWorkspace: options.suiteWorkspace,
    configWorkspace: options.config.run?.workspace,
    suiteDir: path.dirname(resolvedSuitePath),
  });

  const selectedCases = normalizedCases.filter((case_) => {
    return (
      (options.caseId === undefined || case_.id === options.caseId) &&
      (selectedTags.length === 0 || case_.tags?.some((tag) => selectedTags.includes(tag)) === true)
    );
  });

  if (selectedRunners.length === 0) {
    const error = new Error(
      options.runner === undefined
        ? "No runners configured."
        : `No runners matched the requested filter: ${options.runner}`,
    );
    await options.reporter?.onError?.({
      context: createReporterContext({
        cwd: resolveReporterWorkspaceCwd(resolvedWorkspace, outputDir),
        suitePath: resolvedSuitePath,
        outputDir,
        selectedCases,
        selectedRunners,
        scheduleMode,
        maxParallel,
        repeat,
        workspaceMode: resolvedWorkspace.mode,
        caseFilter: options.caseId,
        runnerFilter: options.runner,
        tagFilter: selectedTags,
        declaredTags,
        isInteractive: options.isInteractive,
      }),
      error,
    });
    throw error;
  }

  if (selectedCases.length === 0) {
    const error = new Error("No cases matched the requested filters.");
    await options.reporter?.onError?.({
      context: createReporterContext({
        cwd: resolveReporterWorkspaceCwd(resolvedWorkspace, outputDir),
        suitePath: resolvedSuitePath,
        outputDir,
        selectedCases,
        selectedRunners,
        scheduleMode,
        maxParallel,
        repeat,
        workspaceMode: resolvedWorkspace.mode,
        caseFilter: options.caseId,
        runnerFilter: options.runner,
        tagFilter: selectedTags,
        declaredTags,
        isInteractive: options.isInteractive,
      }),
      error,
    });
    throw error;
  }

  const context = createReporterContext({
    cwd: resolveReporterWorkspaceCwd(resolvedWorkspace, outputDir),
    suitePath: resolvedSuitePath,
    outputDir,
    selectedCases,
    selectedRunners,
    scheduleMode,
    maxParallel,
    repeat,
    workspaceMode: resolvedWorkspace.mode,
    caseFilter: options.caseId,
    runnerFilter: options.runner,
    tagFilter: selectedTags,
    declaredTags,
    isInteractive: options.isInteractive,
  });
  const executeRunnerFn = options.executeRunnerFn ?? executeRunner;
  const snapshotStore = await SnapshotStore.load(options.snapshots);
  const plannedCaseResults = createPlannedCaseResults(selectedCases, selectedRunners.length);
  const plannedExecutions = createPlannedExecutions(selectedCases, selectedRunners, options.config);
  const caseStates = createPlannedCaseStates(selectedCases.length);
  const rejectedRunners = new Map<string, RunnerResult>();
  const restoreMaxListeners = raiseProcessMaxListeners(resolveProcessMaxListeners(maxParallel));
  const sharedWorkspace =
    resolvedWorkspace.mode === "shared"
      ? createSharedWorkspaceState(resolvedWorkspace, {
          outputDir,
          timeoutMs: plannedExecutions.reduce(
            (maxTimeoutMs, execution) => Math.max(maxTimeoutMs, execution.item.timeoutMs),
            120_000,
          ),
        })
      : undefined;

  try {
    await options.reporter?.onSuiteStart?.({
      context,
      cases: selectedCases,
      runners: selectedRunners.map((runner) => runner.info),
      startedAt,
    });

    if (sharedWorkspace !== undefined) {
      await sharedWorkspace.prepare();
    }

    const initialExecutions = plannedExecutions.filter(
      (execution) => execution.item.caseIndex === 0,
    );
    const remainingExecutions = plannedExecutions.filter(
      (execution) => execution.item.caseIndex !== 0,
    );

    for (const execution of initialExecutions) {
      await executePlannedExecution(execution.item, {
        context,
        executeRunnerFn,
        resolvedWorkspace,
        outputDir,
        caseStates,
        caseResults: plannedCaseResults,
        selectedCases,
        selectedRunners,
        snapshots: options.snapshots,
        snapshotStore,
        maxSteps: options.config.run?.maxSteps,
        repeat,
        repeatFailure,
        sharedWorkspace,
        reporter: options.reporter,
        rejectedRunners,
      });
    }

    await scheduleExecutions(remainingExecutions, scheduleMode, maxParallel, async ({ item }) => {
      await executePlannedExecution(item, {
        context,
        executeRunnerFn,
        resolvedWorkspace,
        outputDir,
        caseStates,
        caseResults: plannedCaseResults,
        selectedCases,
        selectedRunners,
        snapshots: options.snapshots,
        snapshotStore,
        maxSteps: options.config.run?.maxSteps,
        repeat,
        repeatFailure,
        sharedWorkspace,
        reporter: options.reporter,
        rejectedRunners,
      });
    });

    const caseResults = plannedCaseResults.map((plannedCaseResult) =>
      aggregatePlannedCaseResult(plannedCaseResult),
    );

    const result: SuiteRunResult = {
      suitePath: resolvedSuitePath,
      startedAt,
      endedAt: nowIso(),
      durationMs: Date.now() - startedMs,
      suiteRunArtifactDir: outputDir,
      declaredTags,
      selectedTags,
      cases: caseResults,
      runners: summarizeRunners(
        caseResults,
        selectedRunners.map((runner) => runner.info),
      ),
    };

    await writeJson(path.join(outputDir, "results.json"), result);
    await snapshotStore?.save();
    if (sharedWorkspace !== undefined) {
      await sharedWorkspace.finalize(result.cases.every((caseResult) => caseResult.passed));
    }
    await options.reporter?.onSuiteFinish?.({ context, result });
    return result;
  } catch (error) {
    await options.reporter?.onError?.({ context, error });
    throw error;
  } finally {
    restoreMaxListeners();
  }
}

function resolveProcessMaxListeners(maxParallel: number): number {
  return Math.max(process.getMaxListeners(), maxParallel * 2);
}

function raiseProcessMaxListeners(target: number): () => void {
  const previous = process.getMaxListeners();

  if (target <= previous) {
    return () => {};
  }

  process.setMaxListeners(target);
  return () => {
    process.setMaxListeners(previous);
  };
}

export function classifyExpectedFailure(case_: Case, result: RunnerResult): RunnerResult {
  const classifiedResult = applyCaseFailureClass(case_, result);

  if (case_.expectedFail !== true) {
    return {
      ...classifiedResult,
      status: classifiedResult.passed ? "passed" : "failed",
    };
  }

  if (classifiedResult.passed) {
    return {
      ...classifiedResult,
      passed: false,
      status: "unexpected-passed",
      failureClass: classifiedResult.failureClass ?? {
        id: "unexpected-passed",
        label: "Unexpected pass",
      },
    };
  }

  if (classifiedResult.failureOrigin === "assertion") {
    return {
      ...classifiedResult,
      passed: true,
      status: "expected-failed",
    };
  }

  return {
    ...classifiedResult,
    status: "failed",
  };
}

function applyCaseFailureClass(case_: Case, result: RunnerResult): RunnerResult {
  if (result.passed) {
    return result;
  }

  const failureClass = case_.classifyFailure?.(result);
  if (failureClass === undefined) {
    return result;
  }

  return {
    ...result,
    failureClass: normalizeFailureClass(failureClass),
  };
}

async function executePlannedExecution(
  item: PlannedSuiteExecution,
  options: {
    context: ReporterContext;
    executeRunnerFn: typeof executeRunner;
    resolvedWorkspace: ReturnType<typeof resolveEffectiveWorkspace>;
    outputDir: string;
    caseStates: PlannedCaseState[];
    caseResults: PlannedCaseResult[];
    selectedCases: Case[];
    selectedRunners: ResolvedRunner[];
    snapshots?: SnapshotRuntimeOptions;
    snapshotStore?: SnapshotStore;
    maxSteps?: number;
    repeat: number;
    repeatFailure: number;
    sharedWorkspace?: SharedWorkspaceState;
    reporter?: BenchmarkReporter;
    rejectedRunners: Map<string, RunnerResult>;
  },
): Promise<void> {
  const state = options.caseStates[item.caseIndex];

  if (state === undefined) {
    throw new Error(`Missing execution state for case index ${String(item.caseIndex)}`);
  }

  if (!state.started) {
    state.started = true;

    await options.reporter?.onCaseStart?.({
      context: options.context,
      case: item.case,
      caseIndex: item.caseIndex + 1,
      totalCases: options.selectedCases.length,
    });
  }

  const artifactDir = path.join(
    options.outputDir,
    sanitizePathSegment(item.case.id),
    item.runner.info.pathKey,
  );
  await ensureDir(artifactDir);

  await options.reporter?.onRunnerStart?.({
    context: options.context,
    case: item.case,
    runner: item.runner.info,
    caseIndex: item.caseIndex + 1,
    totalCases: options.selectedCases.length,
  });

  const repetitions: RepetitionResult[] = [];
  const successfulRepetitions: RepetitionResult[] = [];
  let terminalFailure: RepetitionResult | undefined;
  const maxSessions = options.repeatFailure + 1;

  for (let repetition = 1; repetition <= options.repeat; repetition += 1) {
    const repetitionArtifactDir = resolveRepetitionArtifactDir(artifactDir, repetition);
    await ensureDir(repetitionArtifactDir);
    const sessions: RunnerSessionResult[] = [];
    let repetitionResult: RepetitionResult | undefined;

    for (let session = 1; session <= maxSessions; session += 1) {
      const sessionArtifactDir = resolveSessionArtifactDir(repetitionArtifactDir, session);
      await ensureDir(sessionArtifactDir);

      const rejectedResult = options.rejectedRunners.get(item.runner.id);
      const rawResult =
        rejectedResult === undefined
          ? await runExecution(item, {
              suitePath: options.context.suitePath,
              artifactDir: sessionArtifactDir,
              resolvedWorkspace: options.resolvedWorkspace,
              executeRunnerFn: options.executeRunnerFn,
              outputDir: options.outputDir,
              maxSteps: options.maxSteps,
              sharedWorkspace: options.sharedWorkspace,
            })
          : await createRejectedModelResult(item, sessionArtifactDir);

      if (rejectedResult === undefined && (await isModelRejectedResult(rawResult))) {
        rawResult.failureOrigin = "model-rejected";
        if (rawResult.error?.name === "AssertionError" || rawResult.error === undefined) {
          rawResult.error = {
            name: "Error",
            message: `Runner rejected configured model "${item.runner.info.agent.model ?? "unknown"}" during initial execution.`,
          };
        }
        rawResult.failureLogPath ??= path.join(sessionArtifactDir, "stderr.log");
        options.rejectedRunners.set(item.runner.id, rawResult);
        await writeJson(path.join(sessionArtifactDir, "error.json"), rawResult.error);
        await writeJson(path.join(sessionArtifactDir, "report.json"), rawResult.report);
      }

      const classifiedSession = createSessionResult(
        classifyExpectedFailure(item.case, rawResult),
        session,
      );
      sessions.push(classifiedSession);
      repetitionResult = createRepetitionResult(classifiedSession, repetition, sessions);

      if (!shouldRetry(classifiedSession, options.repeatFailure, session)) {
        break;
      }
    }

    if (repetitionResult === undefined) {
      throw new Error(
        `Execution finished without a repetition result for ${item.case.id} > ${item.runner.id}`,
      );
    }

    repetitions.push(repetitionResult);

    if (repetitionResult.passed) {
      successfulRepetitions.push(repetitionResult);
      continue;
    }

    terminalFailure = repetitionResult;
    break;
  }

  let result = createAggregateRunnerResult({
    runner: item.runner.info,
    artifactDir,
    resultArtifactDir:
      terminalFailure?.artifactDir ?? repetitions.at(-1)?.artifactDir ?? artifactDir,
    repeatTarget: options.repeat,
    repetitions,
    successfulRepetitions,
    terminalFailure,
  });

  if (
    options.snapshots !== undefined &&
    options.snapshotStore !== undefined &&
    successfulRepetitions.length > 0
  ) {
    const snapshotFailure = applyAggregateSnapshotCheck(
      item.case,
      item.runner.info,
      artifactDir,
      successfulRepetitions,
      options.snapshotStore,
      options.snapshots,
    );

    if (snapshotFailure !== undefined) {
      result = createAggregateRunnerResult({
        runner: item.runner.info,
        artifactDir,
        resultArtifactDir: snapshotFailure.artifactDir,
        repeatTarget: options.repeat,
        repetitions,
        successfulRepetitions,
        terminalFailure: classifyExpectedFailure(item.case, snapshotFailure),
      });
    }
  }

  await options.reporter?.onRunnerFinish?.({
    context: options.context,
    case: item.case,
    runner: item.runner.info,
    result,
    caseIndex: item.caseIndex + 1,
    totalCases: options.selectedCases.length,
  });

  options.caseResults[item.caseIndex]!.runnerResults[item.runnerIndex] = result;

  state.completedExecutions += 1;

  if (state.completedExecutions === options.selectedRunners.length) {
    const caseResult = aggregatePlannedCaseResult(options.caseResults[item.caseIndex]!);

    await options.reporter?.onCaseFinish?.({
      context: options.context,
      case: item.case,
      result: caseResult,
      caseIndex: item.caseIndex + 1,
      totalCases: options.selectedCases.length,
    });
  }
}

async function runExecution(
  item: PlannedSuiteExecution,
  options: {
    suitePath: string;
    artifactDir: string;
    resolvedWorkspace: ReturnType<typeof resolveEffectiveWorkspace>;
    executeRunnerFn: typeof executeRunner;
    outputDir: string;
    maxSteps?: number;
    sharedWorkspace?: SharedWorkspaceState;
  },
): Promise<RunnerResult> {
  const executionStartedMs = Date.now();
  let result: RunnerResult;
  let preparedWorkspace;

  try {
    preparedWorkspace =
      options.sharedWorkspace === undefined
        ? await prepareWorkspace(options.resolvedWorkspace, {
            artifactDir: options.artifactDir,
            outputDir: options.outputDir,
            case: item.case,
            runner: item.runner.info,
            timeoutMs: item.timeoutMs,
          })
        : await options.sharedWorkspace.createExecutionWorkspace(options.artifactDir);

    result = await options.executeRunnerFn(
      item.case,
      item.runner.info,
      getAdapter(item.runner.config.agent),
      {
        suitePath: options.suitePath,
        cwd: preparedWorkspace.cwd,
        artifactDir: options.artifactDir,
        timeoutMs: item.timeoutMs,
        maxSteps: options.maxSteps,
      },
    );
  } catch (error) {
    const isWorkspaceFailure = preparedWorkspace === undefined;
    result = createExecutionFailureResult(error, {
      case: item.case,
      runner: item.runner.info,
      artifactDir: options.artifactDir,
      durationMs: Date.now() - executionStartedMs,
      failureOrigin: isWorkspaceFailure ? classifyWorkspaceFailureOrigin(error) : "runner",
      failureLogPath: isWorkspaceFailure
        ? resolveWorkspaceFailureLogPath(options.artifactDir, error)
        : undefined,
    });
    await writeJson(path.join(options.artifactDir, "error.json"), result.error);
    await writeJson(path.join(options.artifactDir, "report.json"), result.report);
  } finally {
    if (preparedWorkspace !== undefined) {
      if (preparedWorkspace.mode === "shared") {
        await writeExecutionWorkspaceMetadata(path.join(options.artifactDir, "workspace.json"), {
          mode: "shared",
          cwd: preparedWorkspace.cwd,
          templateDir: preparedWorkspace.templateDir,
          workspacePath: preparedWorkspace.workspacePath,
          bootstrap: preparedWorkspace.bootstrap,
          preserved: false,
          cleanupError: undefined,
        });
      } else {
        await finalizeWorkspace(preparedWorkspace, {
          artifactDir: options.artifactDir,
          passed: result!.passed,
        });
      }
    }
  }

  return result;
}

function createSessionResult(result: RunnerResult, session: number): RunnerSessionResult {
  return {
    ...result,
    session,
  };
}

function createRepetitionResult(
  result: RunnerSessionResult,
  repetition: number,
  sessions: RunnerSessionResult[],
): RepetitionResult {
  return {
    ...result,
    repetition,
    sessions: [...sessions],
  };
}

function shouldRetry(result: RunnerSessionResult, retryFailed: number, session: number): boolean {
  return !result.passed && session <= retryFailed && result.failureOrigin !== "model-rejected";
}

function resolveRepetitionArtifactDir(artifactDir: string, repetition: number): string {
  return path.join(artifactDir, `repeat-${String(repetition)}`);
}

function resolveSessionArtifactDir(artifactDir: string, session: number): string {
  return session === 1 ? artifactDir : path.join(artifactDir, `session-${String(session)}`);
}

function createAggregateRunnerResult(options: {
  runner: RunnerInfo;
  artifactDir: string;
  resultArtifactDir: string;
  repeatTarget: number;
  repetitions: RepetitionResult[];
  successfulRepetitions: RepetitionResult[];
  terminalFailure?: RepetitionResult | RunnerResult;
}): RunnerResult {
  const aggregateSource =
    options.successfulRepetitions.length > 0
      ? aggregateSuccessfulRepetitions(options.successfulRepetitions)
      : options.terminalFailure === undefined
        ? undefined
        : {
            durationMs: options.terminalFailure.durationMs,
            report: options.terminalFailure.report,
          };

  if (aggregateSource === undefined) {
    throw new Error(`Missing aggregate source for runner ${options.runner.id}`);
  }

  return {
    runner: options.runner,
    passed: options.terminalFailure === undefined,
    status:
      options.terminalFailure?.status ?? options.successfulRepetitions.at(-1)?.status ?? "passed",
    durationMs: aggregateSource.durationMs,
    executionArtifactDir: options.artifactDir,
    artifactDir: options.resultArtifactDir,
    report: aggregateSource.report,
    error: options.terminalFailure?.error,
    failureOrigin: options.terminalFailure?.failureOrigin,
    failureClass: options.terminalFailure?.failureClass,
    failureLogPath: options.terminalFailure?.failureLogPath,
    session: options.repetitions.at(-1)?.session,
    sessions: options.repeatTarget === 1 ? options.repetitions[0]?.sessions : undefined,
    repeatTarget: options.repeatTarget,
    completedRepetitions: options.repetitions.length,
    successfulRepetitions: options.successfulRepetitions.length,
    ...(options.terminalFailure === undefined
      ? {}
      : { stoppedAtRepetition: options.repetitions.at(-1)?.repetition }),
    repetitions: [...options.repetitions],
  };
}

function aggregateSuccessfulRepetitions(
  repetitions: RepetitionResult[],
): Pick<RunnerResult, "durationMs" | "report"> {
  const template = repetitions.at(-1);

  if (template === undefined) {
    throw new Error("Cannot aggregate zero successful repetitions.");
  }

  return {
    durationMs: average(repetitions.map((result) => result.durationMs)),
    report: {
      ...template.report,
      durationMs: averageDefined(repetitions.map((result) => result.report.durationMs)),
      usage: {
        ...template.report.usage,
        inputTokens: averageDefined(repetitions.map((result) => result.report.usage.inputTokens)),
        outputTokens: averageDefined(repetitions.map((result) => result.report.usage.outputTokens)),
        reasoningTokens: averageDefined(
          repetitions.map((result) => result.report.usage.reasoningTokens),
        ),
        cacheTokens: averageDefined(repetitions.map((result) => result.report.usage.cacheTokens)),
        totalTokens: averageDefined(repetitions.map((result) => result.report.usage.totalTokens)),
      },
      rawArtifacts: template.report.rawArtifacts,
    },
  };
}

function applyAggregateSnapshotCheck(
  case_: Case,
  runner: RunnerInfo,
  artifactDir: string,
  repetitions: RepetitionResult[],
  store: SnapshotStore,
  runtime: SnapshotRuntimeOptions,
): RunnerResult | undefined {
  const metric = runtime.config.metric ?? "totalTokens";
  const values = repetitions
    .map((result) => result.report.usage[metric])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (values.length !== repetitions.length) {
    return createExecutionFailureResult(
      new Error(
        `Snapshot check requires provider token metric ${metric}, but it was unavailable for ${case_.id} / ${runner.id}.`,
      ),
      {
        case: case_,
        runner,
        artifactDir,
        durationMs: average(repetitions.map((result) => result.durationMs)),
        failureOrigin: "snapshot",
        report: aggregateSuccessfulRepetitions(repetitions).report,
      },
    );
  }

  try {
    store.check(
      {
        caseId: case_.id,
        runner,
        actual: average(values),
      },
      runtime,
    );
    return undefined;
  } catch (error) {
    return createExecutionFailureResult(error, {
      case: case_,
      runner,
      artifactDir,
      durationMs: average(repetitions.map((result) => result.durationMs)),
      failureOrigin: "snapshot",
      report: aggregateSuccessfulRepetitions(repetitions).report,
    });
  }
}

async function createRejectedModelResult(
  item: PlannedSuiteExecution,
  artifactDir: string,
): Promise<RunnerResult> {
  const result = createExecutionFailureResult(
    new Error(
      `Runner rejected configured model "${item.runner.info.agent.model ?? "unknown"}" during initial execution.`,
    ),
    {
      case: item.case,
      runner: item.runner.info,
      artifactDir,
      durationMs: 0,
      failureOrigin: "model-rejected",
    },
  );

  await writeJson(path.join(artifactDir, "error.json"), result.error);
  await writeJson(path.join(artifactDir, "report.json"), result.report);
  return result;
}

function classifyWorkspaceFailureOrigin(
  error: unknown,
): import("../domain/result.js").RunnerFailureOrigin {
  if (error instanceof Error && error.message.startsWith("Workspace bootstrap failed:")) {
    return "workspace-bootstrap";
  }

  return "workspace";
}

function resolveWorkspaceFailureLogPath(artifactDir: string, error: unknown): string | undefined {
  if (error instanceof Error && error.message.startsWith("Workspace bootstrap failed:")) {
    return path.join(artifactDir, "bootstrap.stderr.log");
  }

  return undefined;
}

function aggregatePlannedCaseResult(plannedCaseResult: PlannedCaseResult): CaseResult {
  const runnerResults = plannedCaseResult.runnerResults.filter(
    (result): result is RunnerResult => result !== undefined,
  );

  if (runnerResults.length !== plannedCaseResult.runnerResults.length) {
    throw new Error(`Missing runner results for case ${plannedCaseResult.case.id}`);
  }

  return {
    caseId: plannedCaseResult.case.id,
    tags: plannedCaseResult.case.tags ?? [],
    passed: runnerResults.every((result) => result.passed),
    runnerResults,
  };
}

function normalizeCases(cases: Case[]): Case[] {
  return cases.map((case_) => ({
    ...case_,
    tags: normalizeTags(case_.tags, `case ${case_.id}`),
  }));
}

function normalizeTags(tags: string[] | undefined, label: string): string[] {
  if (tags === undefined) {
    return [];
  }

  if (!Array.isArray(tags)) {
    throw new Error(`Invalid tags for ${label}: expected array of non-empty strings`);
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const [index, tag] of tags.entries()) {
    if (typeof tag !== "string" || tag.trim().length === 0) {
      throw new Error(
        `Invalid tag for ${label} at index ${String(index)}: expected non-empty string`,
      );
    }

    if (!seen.has(tag)) {
      seen.add(tag);
      normalized.push(tag);
    }
  }

  return normalized;
}

function collectDeclaredTags(cases: Case[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const case_ of cases) {
    for (const tag of case_.tags ?? []) {
      if (!seen.has(tag)) {
        seen.add(tag);
        tags.push(tag);
      }
    }
  }

  return tags;
}

function timestampDirName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function averageDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined);
  if (defined.length === 0) {
    return undefined;
  }

  return average(defined);
}

function isNumber(value: number | undefined): value is number {
  return typeof value === "number";
}

function summarizeRunners(caseResults: CaseResult[], runners: RunnerInfo[]): RunnerSummary[] {
  return runners.map((runner) => {
    const runnerResults = caseResults
      .map((caseResult) =>
        caseResult.runnerResults.find((result) => result.runner.id === runner.id),
      )
      .filter((result): result is RunnerResult => result !== undefined);
    const inputTokens = runnerResults
      .map((result) => result.report.usage.inputTokens)
      .filter(isNumber);
    const outputTokens = runnerResults
      .map((result) => result.report.usage.outputTokens)
      .filter(isNumber);
    const reasoningTokens = runnerResults
      .map((result) => result.report.usage.reasoningTokens)
      .filter(isNumber);
    const cacheTokens = runnerResults
      .map((result) => result.report.usage.cacheTokens)
      .filter(isNumber);
    const totalTokens = runnerResults
      .map((result) => result.report.usage.totalTokens)
      .filter(isNumber);
    const passedCases = runnerResults.filter((result) => result.passed).length;

    return {
      runner,
      totalCases: runnerResults.length,
      passedCases,
      successRate: runnerResults.length === 0 ? 0 : passedCases / runnerResults.length,
      averageDurationMs: average(runnerResults.map((result) => result.durationMs)),
      averageInputTokens: inputTokens.length > 0 ? average(inputTokens) : undefined,
      averageOutputTokens: outputTokens.length > 0 ? average(outputTokens) : undefined,
      averageReasoningTokens: reasoningTokens.length > 0 ? average(reasoningTokens) : undefined,
      averageCacheTokens: cacheTokens.length > 0 ? average(cacheTokens) : undefined,
      averageTotalTokens: totalTokens.length > 0 ? average(totalTokens) : undefined,
    };
  });
}

function selectRunners(
  runners: Record<string, RunnerConfig>,
  runnerFilter?: string,
): ResolvedRunner[] {
  return Object.entries(runners)
    .filter(([id]) => runnerFilter === undefined || id === runnerFilter)
    .map(([id, config]) => ({
      id,
      config,
      info: createRunnerInfo(id, config.agent),
    }));
}

function createPlannedExecutions(
  selectedCases: Case[],
  selectedRunners: ResolvedRunner[],
  config: {
    defaults?: {
      timeoutMs?: number;
    };
    runners: Record<string, RunnerConfig>;
  },
): Array<PlannedExecution<PlannedSuiteExecution>> {
  return selectedCases.flatMap((case_, caseIndex) => {
    const executionOptions = getCaseExecutionOptions(case_, config);

    return selectedRunners.map((runner, runnerIndex) => ({
      runnerId: runner.id,
      item: {
        case: case_,
        runner,
        caseIndex,
        runnerIndex,
        timeoutMs: executionOptions.timeoutMs,
      },
    }));
  });
}

function createPlannedCaseResults(selectedCases: Case[], runnerCount: number): PlannedCaseResult[] {
  return selectedCases.map((case_) => ({
    case: case_,
    runnerResults: Array.from({ length: runnerCount }, () => undefined),
  }));
}

function createPlannedCaseStates(caseCount: number): PlannedCaseState[] {
  return Array.from({ length: caseCount }, () => ({
    started: false,
    completedExecutions: 0,
  }));
}

function createReporterContext(options: {
  cwd: string;
  workspaceMode: "none" | "shared" | "isolated";
  suitePath: string;
  outputDir: string;
  selectedCases: Case[];
  selectedRunners: ResolvedRunner[];
  scheduleMode: ScheduleMode;
  maxParallel: number;
  repeat: number;
  caseFilter?: string;
  runnerFilter?: string;
  tagFilter: string[];
  declaredTags: string[];
  isInteractive?: boolean;
}): ReporterContext {
  return {
    isInteractive: options.isInteractive ?? Boolean(process.stdout.isTTY),
    cwd: options.cwd,
    workspaceMode: options.workspaceMode,
    suitePath: options.suitePath,
    suiteRunArtifactDir: options.outputDir,
    selectedCaseCount: options.selectedCases.length,
    selectedRunnerCount: options.selectedRunners.length,
    selectedExecutionCount: options.selectedCases.length * options.selectedRunners.length,
    repeat: options.repeat,
    scheduleMode: options.scheduleMode,
    maxParallel: options.maxParallel,
    caseFilter: options.caseFilter,
    runnerFilter: options.runnerFilter,
    tagFilter: options.tagFilter.length === 0 ? undefined : options.tagFilter,
    declaredTags: options.declaredTags,
  };
}

interface SharedWorkspaceState {
  prepare(): Promise<void>;
  createExecutionWorkspace(
    artifactDir: string,
  ): Promise<Awaited<ReturnType<typeof prepareSharedWorkspace>>>;
  finalize(passed: boolean): Promise<void>;
}

function createSharedWorkspaceState(
  config: ReturnType<typeof resolveEffectiveWorkspace>,
  options: {
    outputDir: string;
    timeoutMs: number;
  },
): SharedWorkspaceState {
  const setupArtifactDir = path.join(options.outputDir, "workspaces", "shared-setup");
  let preparedPromise: Promise<Awaited<ReturnType<typeof prepareSharedWorkspace>>> | undefined;

  const loadPreparedWorkspace = () => {
    preparedPromise ??= (async () => {
      await ensureDir(setupArtifactDir);
      return prepareSharedWorkspace(config, {
        outputDir: options.outputDir,
        artifactDir: setupArtifactDir,
        timeoutMs: options.timeoutMs,
      });
    })();

    return preparedPromise;
  };

  return {
    async prepare() {
      await loadPreparedWorkspace();
    },
    async createExecutionWorkspace() {
      return loadPreparedWorkspace();
    },
    async finalize(passed) {
      if (!passed) {
        return;
      }

      const preparedWorkspace = await loadPreparedWorkspace();
      await preparedWorkspace.cleanup();
    },
  };
}

function resolveReporterWorkspaceCwd(
  resolvedWorkspace: ReturnType<typeof resolveEffectiveWorkspace>,
  outputDir: string,
): string {
  if (resolvedWorkspace.mode === "shared") {
    return getSharedWorkspacePath(outputDir);
  }

  return resolvedWorkspace.mode === "none" ? resolvedWorkspace.cwd : outputDir;
}

function resolveMaxParallel(
  scheduleMode: ScheduleMode,
  configuredMaxParallel: number | undefined,
): number {
  if (scheduleMode === "serial") {
    return 1;
  }

  return Math.max(1, configuredMaxParallel ?? os.availableParallelism());
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}
