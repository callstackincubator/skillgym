import { expect, test } from "vitest";
import type { RunnerResult, SuiteRunResult } from "../../src/index.js";
import { createTokenUsageReporter } from "../../src/reporters/token-usage.js";
import { createRunnerInfo } from "../../src/runner/runner-info.js";
import { createSessionReport } from "../helpers/session-report.js";

test("token-usage reporter summarizes comparable billable rows as strict JSON", async () => {
  const writes: string[] = [];
  const reporter = createTokenUsageReporter({
    stdout: {
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    },
  });

  const mainRunner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const fallbackRunner = createRunnerInfo("open-fallback", {
    type: "opencode",
    model: "openai/gpt-5-mini",
  });
  const result: SuiteRunResult = {
    suitePath: "examples/basic-suite.ts",
    startedAt: "2026-04-02T12:00:00.000Z",
    endedAt: "2026-04-02T12:01:00.000Z",
    durationMs: 60_000,
    suiteRunArtifactDir: ".skillgym-results/run-1",
    declaredTags: [],
    selectedTags: [],
    cases: [
      {
        caseId: "case-a",
        tags: [],
        passed: true,
        runnerResults: [
          createRunnerResult(mainRunner, {
            status: "passed",
            usage: {
              inputTokens: 1000,
              outputTokens: 150,
              reasoningTokens: 50,
              cacheTokens: 0,
              totalTokens: 1200,
              source: { input: "provider", output: "provider", reasoning: "provider" },
            },
          }),
          createRunnerResult(fallbackRunner, {
            status: "passed",
            successfulRepetitions: 2,
            repetitions: [
              createRepetitionResult(fallbackRunner, 1, {
                inputTokens: 1700,
                outputTokens: 250,
                reasoningTokens: 150,
                cacheTokens: 0,
                totalTokens: 2100,
                source: { input: "provider", output: "provider", reasoning: "provider" },
              }),
              createRepetitionResult(fallbackRunner, 2, {
                inputTokens: 1700,
                outputTokens: 250,
                reasoningTokens: 150,
                cacheTokens: 0,
                totalTokens: 2100,
                source: { input: "provider", output: "provider", reasoning: "provider" },
              }),
            ],
            usage: {
              inputTokens: 1700,
              outputTokens: 250,
              reasoningTokens: 150,
              cacheTokens: 0,
              totalTokens: 2100,
              source: { input: "provider", output: "provider", reasoning: "provider" },
            },
          }),
        ],
      },
      {
        caseId: "case-b",
        tags: [],
        passed: false,
        runnerResults: [
          createRunnerResult(mainRunner, {
            status: "failed",
            failureOrigin: "assertion",
            failureClass: { id: "missing-rule", label: "Missing rule" },
            error: { name: "AssertionError", message: "expected prompt to keep critical rule" },
            usage: {
              inputTokens: 900,
              outputTokens: 200,
              reasoningTokens: 100,
              cacheTokens: 0,
              totalTokens: 1200,
              source: { input: "provider", output: "provider", reasoning: "provider" },
            },
          }),
          createRunnerResult(fallbackRunner, {
            status: "passed",
            usage: {
              inputTokens: 600,
              outputTokens: 150,
              reasoningTokens: 40,
              cacheTokens: 0,
              totalTokens: 790,
              source: { input: "derived", output: "derived", reasoning: "derived" },
            },
          }),
        ],
      },
      {
        caseId: "case-c",
        tags: [],
        passed: true,
        runnerResults: [
          createRunnerResult(mainRunner, {
            status: "passed",
            usage: {
              inputTokens: undefined,
              outputTokens: undefined,
              reasoningTokens: undefined,
              cacheTokens: undefined,
              totalTokens: undefined,
              source: { input: "chars", output: "chars", reasoning: "chars" },
            },
          }),
        ],
      },
    ],
    runners: [
      {
        runner: mainRunner,
        totalCases: 3,
        passedCases: 2,
        successRate: 2 / 3,
        averageDurationMs: 1000,
        averageTotalTokens: 1200,
      },
      {
        runner: fallbackRunner,
        totalCases: 2,
        passedCases: 2,
        successRate: 1,
        averageDurationMs: 1000,
        averageTotalTokens: 1445,
      },
    ],
  };

  const context = {
    isInteractive: false,
    cwd: "/workspace",
    workspaceMode: "shared" as const,
    suitePath: result.suitePath,
    suiteRunArtifactDir: result.suiteRunArtifactDir,
    selectedCaseCount: 3,
    selectedRunnerCount: 2,
    selectedExecutionCount: 5,
    scheduleMode: "serial" as const,
    maxParallel: 1,
    declaredTags: [],
  };

  await reporter.onSuiteFinish?.({ context, result });

  expect(writes).toHaveLength(1);
  expect(() => JSON.parse(writes[0]!)).not.toThrow();

  const output = JSON.parse(writes[0]!) as {
    passed: boolean;
    billable: { sum: number; avg: number } | null;
    artifacts: string;
    rows: Array<{
      case: string;
      runner: string;
      passed: boolean;
      status: string;
      usage: string;
      billable: { sum: number; avg: number } | null;
      failureOrigin?: string;
      failureClass?: { id: string; label?: string };
      error?: { name: string; message: string };
      artifactDir?: string;
    }>;
  };

  expect(output.passed).toBe(false);
  expect(output.billable).toEqual({ sum: 5400, avg: 1650 });
  expect(output.artifacts).toBe(".skillgym-results/run-1");
  expect(output.rows).toEqual([
    {
      case: "case-a",
      runner: "open-main",
      passed: true,
      status: "passed",
      usage: "provider",
      billable: { sum: 1200, avg: 1200 },
    },
    {
      case: "case-a",
      runner: "open-fallback",
      passed: true,
      status: "passed",
      usage: "provider",
      billable: { sum: 4200, avg: 2100 },
    },
    {
      case: "case-b",
      runner: "open-main",
      passed: false,
      status: "failed",
      usage: "provider",
      billable: null,
      failureOrigin: "assertion",
      failureClass: { id: "missing-rule", label: "Missing rule" },
      error: { name: "AssertionError", message: "expected prompt to keep critical rule" },
    },
    {
      case: "case-b",
      runner: "open-fallback",
      passed: true,
      status: "passed",
      usage: "derived",
      billable: null,
    },
    {
      case: "case-c",
      runner: "open-main",
      passed: true,
      status: "passed",
      usage: "unavailable",
      billable: null,
    },
  ]);

  for (const row of output.rows) {
    expect(row.artifactDir).toBeUndefined();
  }
});

test("token-usage reporter is silent until suite finishes", async () => {
  const writes: string[] = [];
  const reporter = createTokenUsageReporter({
    stdout: {
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    },
  });

  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const context = {
    isInteractive: false,
    cwd: "/workspace",
    workspaceMode: "shared" as const,
    suitePath: "suite.ts",
    suiteRunArtifactDir: ".skillgym-results/run-1",
    selectedCaseCount: 1,
    selectedRunnerCount: 1,
    selectedExecutionCount: 1,
    scheduleMode: "serial" as const,
    maxParallel: 1,
    declaredTags: [],
  };

  await reporter.onSuiteStart?.({
    context,
    cases: [],
    runners: [runner],
    startedAt: "2026-04-02T12:00:00.000Z",
  });
  await reporter.onRunnerStart?.({
    context,
    case: { id: "case-a", prompt: "", assert() {} },
    runner,
    caseIndex: 1,
    totalCases: 1,
  });

  expect(writes).toHaveLength(0);
});

function createRunnerResult(
  runner: ReturnType<typeof createRunnerInfo>,
  options: {
    status: RunnerResult["status"];
    usage: {
      inputTokens?: number;
      outputTokens?: number;
      reasoningTokens?: number;
      cacheTokens?: number;
      totalTokens?: number;
      source: {
        input: "provider" | "derived" | "chars";
        output: "provider" | "derived" | "chars";
        reasoning: "provider" | "derived" | "chars";
      };
    };
    successfulRepetitions?: number;
    repetitions?: RunnerResult["repetitions"];
    error?: RunnerResult["error"];
    failureOrigin?: RunnerResult["failureOrigin"];
    failureClass?: RunnerResult["failureClass"];
  },
): RunnerResult {
  return {
    runner,
    passed: options.status === "passed",
    status: options.status,
    durationMs: 1000,
    executionArtifactDir: ".skillgym-results/run-1/execution",
    artifactDir: ".skillgym-results/run-1/execution",
    report: createSessionReport({
      runner,
      usage: {
        inputTokens: options.usage.inputTokens,
        outputTokens: options.usage.outputTokens,
        reasoningTokens: options.usage.reasoningTokens,
        cacheTokens: options.usage.cacheTokens,
        totalTokens: options.usage.totalTokens,
        inputChars: 100,
        outputChars: 40,
        reasoningChars: 20,
        source: options.usage.source,
      },
    }),
    successfulRepetitions: options.successfulRepetitions,
    repetitions: options.repetitions,
    error: options.error,
    failureOrigin: options.failureOrigin,
    failureClass: options.failureClass,
  };
}

function createRepetitionResult(
  runner: ReturnType<typeof createRunnerInfo>,
  repetition: number,
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cacheTokens?: number;
    totalTokens?: number;
    source: {
      input: "provider" | "derived" | "chars";
      output: "provider" | "derived" | "chars";
      reasoning: "provider" | "derived" | "chars";
    };
  },
): NonNullable<RunnerResult["repetitions"]>[number] {
  return {
    ...createRunnerResult(runner, { status: "passed", usage }),
    repetition,
  };
}
