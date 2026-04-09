import path from "node:path";
import process from "node:process";
import { getCaseExecutionOptions } from "../config.js";
import type { CaseResult, RunnerResult, RunnerSummary, SuiteRunResult } from "../domain/result.js";
import type { ResolvedRunner, RunnerConfig, RunnerInfo } from "../domain/runner.js";
import type { ScheduleMode } from "../domain/schedule.js";
import type { SuiteWorkspaceConfig, TestCase } from "../domain/test-case.js";
import { getAdapter } from "../adapters/index.js";
import type { BenchmarkReporter, ReporterContext } from "../reporters/contract.js";
import { SnapshotStore, type SnapshotRuntimeOptions } from "../snapshots/store.js";
import { ensureDir, writeJson } from "../utils/fs.js";
import { average, nowIso } from "../utils/time.js";
import { createRunnerInfo } from "./runner-info.js";
import { executeRunner } from "./execute-runner.js";
import { scheduleExecutions, type PlannedExecution } from "./scheduler.js";
import { createExecutionFailureResult, finalizeWorkspace, prepareWorkspace, resolveEffectiveWorkspace } from "./workspace.js";

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
    caseId?: string;
    runner?: string;
    config: {
      defaults?: {
        timeoutMs?: number;
      };
      run?: {
        workspace?: SuiteWorkspaceConfig;
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
  await ensureDir(outputDir);
  const selectedRunners = selectRunners(options.config.runners, options.runner);
  const resolvedWorkspace = resolveEffectiveWorkspace({
    baseCwd: options.cwd,
    suiteWorkspace: options.suiteWorkspace,
    configWorkspace: options.config.run?.workspace,
    suiteDir: path.dirname(resolvedSuitePath),
  });

  const selectedCases = testCases.filter((testCase) => {
    return options.caseId === undefined || testCase.id === options.caseId;
  });

  if (selectedRunners.length === 0) {
    const error = new Error(options.runner === undefined
      ? "No runners configured."
      : `No runners matched the requested filter: ${options.runner}`);
    await options.reporter?.onError?.({
      context: createReporterContext({
        cwd: resolvedWorkspace.mode === "shared" ? resolvedWorkspace.cwd : options.cwd,
        suitePath: resolvedSuitePath,
        outputDir,
        selectedCases,
        selectedRunners,
        scheduleMode,
        workspaceMode: resolvedWorkspace.mode,
        caseFilter: options.caseId,
        runnerFilter: options.runner,
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
        workspaceMode: resolvedWorkspace.mode,
        caseFilter: options.caseId,
        runnerFilter: options.runner,
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
    workspaceMode: resolvedWorkspace.mode,
    caseFilter: options.caseId,
    runnerFilter: options.runner,
    isInteractive: options.isInteractive,
  });
  const executeRunnerFn = options.executeRunnerFn ?? executeRunner;
  const snapshotStore = await SnapshotStore.load(options.snapshots);
  const plannedCaseResults = createPlannedCaseResults(selectedCases, selectedRunners.length);
  const plannedExecutions = createPlannedExecutions(selectedCases, selectedRunners, options.config);
  const caseStates = createPlannedCaseStates(selectedCases.length);

  try {
    await options.reporter?.onSuiteStart?.({
      context,
      cases: selectedCases,
      runners: selectedRunners.map((runner) => runner.info),
      startedAt,
    });

    await scheduleExecutions(plannedExecutions, scheduleMode, async ({ item }) => {
      const state = caseStates[item.caseIndex];

      if (state === undefined) {
        throw new Error(`Missing execution state for case index ${String(item.caseIndex)}`);
      }

      if (!state.started) {
        state.started = true;

        await options.reporter?.onCaseStart?.({
          context,
          testCase: item.testCase,
          caseIndex: item.caseIndex + 1,
          totalCases: selectedCases.length,
        });
      }

      await options.reporter?.onRunnerStart?.({
        context,
        testCase: item.testCase,
        runner: item.runner.info,
        caseIndex: item.caseIndex + 1,
        totalCases: selectedCases.length,
      });

      const artifactDir = path.join(outputDir, sanitizePathSegment(item.testCase.id), item.runner.info.pathKey);
      await ensureDir(artifactDir);

      const executionStartedMs = Date.now();
      let result: RunnerResult;
      let preparedWorkspace;

      try {
        preparedWorkspace = await prepareWorkspace(resolvedWorkspace, {
          artifactDir,
          outputDir,
          testCase: item.testCase,
          runner: item.runner.info,
          timeoutMs: item.timeoutMs,
        });

        result = await executeRunnerFn(item.testCase, item.runner.info, getAdapter(item.runner.config.agent), {
          cwd: preparedWorkspace.cwd,
          artifactDir,
          timeoutMs: item.timeoutMs,
          snapshots: options.snapshots !== undefined && snapshotStore !== undefined
            ? { runtime: options.snapshots, store: snapshotStore }
            : undefined,
        });
      } catch (error) {
        result = createExecutionFailureResult(error, {
          testCase: item.testCase,
          runner: item.runner.info,
          artifactDir,
          durationMs: Date.now() - executionStartedMs,
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

      plannedCaseResults[item.caseIndex]!.runnerResults[item.runnerIndex] = result;

      await options.reporter?.onRunnerFinish?.({
        context,
        testCase: item.testCase,
        runner: item.runner.info,
        result,
        caseIndex: item.caseIndex + 1,
        totalCases: selectedCases.length,
      });

      state.completedRuns += 1;

      if (state.completedRuns === selectedRunners.length) {
        const caseResult = aggregatePlannedCaseResult(plannedCaseResults[item.caseIndex]!);

        await options.reporter?.onCaseFinish?.({
          context,
          testCase: item.testCase,
          result: caseResult,
          caseIndex: item.caseIndex + 1,
          totalCases: selectedCases.length,
        });
      }
    });

    const caseResults = plannedCaseResults.map((plannedCaseResult) => aggregatePlannedCaseResult(plannedCaseResult));

    const result: SuiteRunResult = {
      suitePath: resolvedSuitePath,
      startedAt,
      endedAt: nowIso(),
      durationMs: Date.now() - startedMs,
      outputDir,
      cases: caseResults,
      runners: summarizeRunners(caseResults, selectedRunners.map((runner) => runner.info)),
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

function aggregatePlannedCaseResult(plannedCaseResult: PlannedCaseResult): CaseResult {
  const runnerResults = plannedCaseResult.runnerResults.filter((result): result is RunnerResult => result !== undefined);

  if (runnerResults.length !== plannedCaseResult.runnerResults.length) {
    throw new Error(`Missing runner results for case ${plannedCaseResult.testCase.id}`);
  }

  return {
    caseId: plannedCaseResult.testCase.id,
    passed: runnerResults.every((result) => result.passed),
    runnerResults,
  };
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
      .map((caseResult) => caseResult.runnerResults.find((result) => result.runner.id === runner.id))
      .filter((result): result is RunnerResult => result !== undefined);
    const inputTokens = runnerResults.map((result) => result.report.usage.inputTokens).filter(isNumber);
    const outputTokens = runnerResults.map((result) => result.report.usage.outputTokens).filter(isNumber);
    const reasoningTokens = runnerResults.map((result) => result.report.usage.reasoningTokens).filter(isNumber);
    const cacheTokens = runnerResults.map((result) => result.report.usage.cacheTokens).filter(isNumber);
    const totalTokens = runnerResults.map((result) => result.report.usage.totalTokens).filter(isNumber);
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

function createPlannedCaseResults(selectedCases: TestCase[], runnerCount: number): PlannedCaseResult[] {
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
  caseFilter?: string;
  runnerFilter?: string;
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
    caseFilter: options.caseFilter,
    runnerFilter: options.runnerFilter,
  };
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}
