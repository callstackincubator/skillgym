import path from "node:path";
import process from "node:process";
import os from "node:os";
import { getCaseExecutionOptions } from "../config.js";
import type { CaseResult, RunnerResult, RunnerSummary, SuiteRunResult } from "../domain/result.js";
import type { ResolvedRunner, RunnerConfig, RunnerInfo } from "../domain/runner.js";
import type { ScheduleMode } from "../domain/schedule.js";
import type { SuiteWorkspaceConfig, TestCase } from "../domain/test-case.js";
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
  prepareWorkspace,
  resolveEffectiveWorkspace,
} from "./workspace.js";

interface PlannedSuiteExecution {
  testCase: TestCase;
  runner: ResolvedRunner;
  caseIndex: number;
  runnerIndex: number;
  timeoutMs: number;
}

interface PlannedCaseResult {
  testCase: TestCase;
  runnerResults: Array<RunnerResult | undefined>;
}

interface PlannedCaseState {
  started: boolean;
  completedRuns: number;
}

export async function executeSuite(
  suitePath: string,
  testCases: TestCase[],
  options: {
    cwd: string;
    outputDir?: string;
    schedule?: ScheduleMode;
    maxParallel?: number;
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
  const outputDir = path.resolve(options.outputDir ?? ".skillgym-results", timestampDirName());
  const scheduleMode = options.schedule ?? "serial";
  const maxParallel = resolveMaxParallel(scheduleMode, options.maxParallel);
  await ensureDir(outputDir);
  const selectedRunners = selectRunners(options.config.runners, options.runner);
  const normalizedCases = normalizeTestCases(testCases);
  const declaredTags = collectDeclaredTags(normalizedCases);
  const selectedTags = normalizeTags(options.tags ?? options.config.run?.tags, "tag filters");
  const resolvedWorkspace = resolveEffectiveWorkspace({
    baseCwd: options.cwd,
    suiteWorkspace: options.suiteWorkspace,
    configWorkspace: options.config.run?.workspace,
    suiteDir: path.dirname(resolvedSuitePath),
  });

  const selectedCases = normalizedCases.filter((testCase) => {
    return (
      (options.caseId === undefined || testCase.id === options.caseId) &&
      (selectedTags.length === 0 ||
        testCase.tags?.some((tag) => selectedTags.includes(tag)) === true)
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
        cwd: resolvedWorkspace.mode === "shared" ? resolvedWorkspace.cwd : options.cwd,
        suitePath: resolvedSuitePath,
        outputDir,
        selectedCases,
        selectedRunners,
        scheduleMode,
        maxParallel,
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
    const error = new Error("No test cases matched the requested filters.");
    await options.reporter?.onError?.({
      context: createReporterContext({
        cwd: resolvedWorkspace.mode === "shared" ? resolvedWorkspace.cwd : options.cwd,
        suitePath: resolvedSuitePath,
        outputDir,
        selectedCases,
        selectedRunners,
        scheduleMode,
        maxParallel,
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
    cwd: resolvedWorkspace.mode === "shared" ? resolvedWorkspace.cwd : options.cwd,
    suitePath: resolvedSuitePath,
    outputDir,
    selectedCases,
    selectedRunners,
    scheduleMode,
    maxParallel,
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

  try {
    await options.reporter?.onSuiteStart?.({
      context,
      cases: selectedCases,
      runners: selectedRunners.map((runner) => runner.info),
      startedAt,
    });

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
      outputDir,
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
    await options.reporter?.onSuiteFinish?.({ context, result });
    return result;
  } catch (error) {
    await options.reporter?.onError?.({ context, error });
    throw error;
  }
}

export function classifyExpectedFailure(testCase: TestCase, result: RunnerResult): RunnerResult {
  const classifiedResult = applyTestCaseFailureClass(testCase, result);

  if (testCase.expectedFail !== true) {
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

  if (
    classifiedResult.failureType === "assertion" &&
    classifiedResult.failureOrigin === "assertion"
  ) {
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

function applyTestCaseFailureClass(testCase: TestCase, result: RunnerResult): RunnerResult {
  if (result.passed) {
    return result;
  }

  const failureClass = testCase.classifyFailure?.(result);
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
    selectedCases: TestCase[];
    selectedRunners: ResolvedRunner[];
    snapshots?: SnapshotRuntimeOptions;
    snapshotStore?: SnapshotStore;
    maxSteps?: number;
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
      testCase: item.testCase,
      caseIndex: item.caseIndex + 1,
      totalCases: options.selectedCases.length,
    });
  }

  await options.reporter?.onRunnerStart?.({
    context: options.context,
    testCase: item.testCase,
    runner: item.runner.info,
    caseIndex: item.caseIndex + 1,
    totalCases: options.selectedCases.length,
  });

  const artifactDir = path.join(
    options.outputDir,
    sanitizePathSegment(item.testCase.id),
    item.runner.info.pathKey,
  );
  await ensureDir(artifactDir);

  const rejectedResult = options.rejectedRunners.get(item.runner.id);
  const rawResult =
    rejectedResult === undefined
      ? await runExecution(item, {
          resolvedWorkspace: options.resolvedWorkspace,
          executeRunnerFn: options.executeRunnerFn,
          outputDir: options.outputDir,
          maxSteps: options.maxSteps,
          snapshots: options.snapshots,
          snapshotStore: options.snapshotStore,
        })
      : await createRejectedModelResult(item, artifactDir);

  if (rejectedResult === undefined && (await isModelRejectedResult(rawResult))) {
    rawResult.failureType = "runner-crash";
    rawResult.failureOrigin = "model-rejected";
    if (rawResult.error?.name === "AssertionError" || rawResult.error === undefined) {
      rawResult.error = {
        name: "Error",
        message: `Runner rejected configured model "${item.runner.info.agent.model ?? "unknown"}" during initial execution.`,
      };
    }
    rawResult.failureLogPath ??= path.join(artifactDir, "stderr.log");
    options.rejectedRunners.set(item.runner.id, rawResult);
    await writeJson(path.join(artifactDir, "error.json"), rawResult.error);
    await writeJson(path.join(artifactDir, "report.json"), rawResult.report);
  }

  const result = classifyExpectedFailure(item.testCase, rawResult);

  options.caseResults[item.caseIndex]!.runnerResults[item.runnerIndex] = result;

  await options.reporter?.onRunnerFinish?.({
    context: options.context,
    testCase: item.testCase,
    runner: item.runner.info,
    result,
    caseIndex: item.caseIndex + 1,
    totalCases: options.selectedCases.length,
  });

  state.completedRuns += 1;

  if (state.completedRuns === options.selectedRunners.length) {
    const caseResult = aggregatePlannedCaseResult(options.caseResults[item.caseIndex]!);

    await options.reporter?.onCaseFinish?.({
      context: options.context,
      testCase: item.testCase,
      result: caseResult,
      caseIndex: item.caseIndex + 1,
      totalCases: options.selectedCases.length,
    });
  }
}

async function runExecution(
  item: PlannedSuiteExecution,
  options: {
    resolvedWorkspace: ReturnType<typeof resolveEffectiveWorkspace>;
    executeRunnerFn: typeof executeRunner;
    outputDir: string;
    maxSteps?: number;
    snapshots?: SnapshotRuntimeOptions;
    snapshotStore?: SnapshotStore;
  },
): Promise<RunnerResult> {
  const artifactDir = path.join(
    options.outputDir,
    sanitizePathSegment(item.testCase.id),
    item.runner.info.pathKey,
  );
  const executionStartedMs = Date.now();
  let result: RunnerResult;
  let preparedWorkspace;

  try {
    preparedWorkspace = await prepareWorkspace(options.resolvedWorkspace, {
      artifactDir,
      outputDir: options.outputDir,
      testCase: item.testCase,
      runner: item.runner.info,
      timeoutMs: item.timeoutMs,
    });

    result = await options.executeRunnerFn(
      item.testCase,
      item.runner.info,
      getAdapter(item.runner.config.agent),
      {
        cwd: preparedWorkspace.cwd,
        artifactDir,
        timeoutMs: item.timeoutMs,
        maxSteps: options.maxSteps,
        snapshots:
          options.snapshots !== undefined && options.snapshotStore !== undefined
            ? { runtime: options.snapshots, store: options.snapshotStore }
            : undefined,
      },
    );
  } catch (error) {
    const isWorkspaceFailure = preparedWorkspace === undefined;
    result = createExecutionFailureResult(error, {
      testCase: item.testCase,
      runner: item.runner.info,
      artifactDir,
      durationMs: Date.now() - executionStartedMs,
      failureOrigin: isWorkspaceFailure ? classifyWorkspaceFailureOrigin(error) : undefined,
      failureLogPath: isWorkspaceFailure
        ? resolveWorkspaceFailureLogPath(artifactDir, error)
        : undefined,
    });
    await writeJson(path.join(artifactDir, "error.json"), result.error);
    await writeJson(path.join(artifactDir, "report.json"), result.report);
  } finally {
    if (preparedWorkspace !== undefined) {
      await finalizeWorkspace(preparedWorkspace, {
        artifactDir,
        passed: result!.passed,
      });
    }
  }

  return result;
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
      testCase: item.testCase,
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

  return "workspace-setup";
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
    throw new Error(`Missing runner results for case ${plannedCaseResult.testCase.id}`);
  }

  return {
    caseId: plannedCaseResult.testCase.id,
    tags: plannedCaseResult.testCase.tags ?? [],
    passed: runnerResults.every((result) => result.passed),
    runnerResults,
  };
}

function normalizeTestCases(testCases: TestCase[]): TestCase[] {
  return testCases.map((testCase) => ({
    ...testCase,
    tags: normalizeTags(testCase.tags, `case ${testCase.id}`),
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

function collectDeclaredTags(testCases: TestCase[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const testCase of testCases) {
    for (const tag of testCase.tags ?? []) {
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
  selectedCases: TestCase[],
  selectedRunners: ResolvedRunner[],
  config: {
    defaults?: {
      timeoutMs?: number;
    };
    runners: Record<string, RunnerConfig>;
  },
): Array<PlannedExecution<PlannedSuiteExecution>> {
  return selectedCases.flatMap((testCase, caseIndex) => {
    const executionOptions = getCaseExecutionOptions(testCase, config);

    return selectedRunners.map((runner, runnerIndex) => ({
      runnerId: runner.id,
      item: {
        testCase,
        runner,
        caseIndex,
        runnerIndex,
        timeoutMs: executionOptions.timeoutMs,
      },
    }));
  });
}

function createPlannedCaseResults(
  selectedCases: TestCase[],
  runnerCount: number,
): PlannedCaseResult[] {
  return selectedCases.map((testCase) => ({
    testCase,
    runnerResults: Array.from({ length: runnerCount }, () => undefined),
  }));
}

function createPlannedCaseStates(caseCount: number): PlannedCaseState[] {
  return Array.from({ length: caseCount }, () => ({
    started: false,
    completedRuns: 0,
  }));
}

function createReporterContext(options: {
  cwd: string;
  workspaceMode: "shared" | "isolated";
  suitePath: string;
  outputDir: string;
  selectedCases: TestCase[];
  selectedRunners: ResolvedRunner[];
  scheduleMode: ScheduleMode;
  maxParallel: number;
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
    outputDir: options.outputDir,
    selectedCaseCount: options.selectedCases.length,
    selectedRunnerCount: options.selectedRunners.length,
    selectedExecutionCount: options.selectedCases.length * options.selectedRunners.length,
    scheduleMode: options.scheduleMode,
    maxParallel: options.maxParallel,
    caseFilter: options.caseFilter,
    runnerFilter: options.runnerFilter,
    tagFilter: options.tagFilter.length === 0 ? undefined : options.tagFilter,
    declaredTags: options.declaredTags,
  };
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
