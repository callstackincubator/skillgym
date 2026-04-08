import { afterEach, expect, test, vi } from "vitest";
import type { CaseResult, RunnerInfo, RunnerResult, RunnerSummary, SuiteRunResult } from "../../src/index.ts";
import { createStandardReporter } from "../../src/reporters/standard.ts";
import { createRunnerInfo } from "../../src/runner/runner-info.ts";
import { createSessionReport } from "../helpers/session-report.ts";

afterEach(() => {
  vi.useRealTimers();
});

test("standard reporter prints runner-grouped results and failure artifacts", async () => {
  const writes: string[] = [];
  const reporter = createStandardReporter({
    stdout: {
      isTTY: false,
      columns: 120,
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    },
    isInteractive: false,
    isUnicode: true,
  });

  const openRunner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const codeRunner = createRunnerInfo("code-main", { type: "codex", model: "gpt-5.4" });
  const context = {
    isInteractive: false,
    cwd: "/workspace",
    workspaceMode: "shared" as const,
    suitePath: "examples/basic-suite.ts",
    outputDir: ".skillgym-results/run-1",
    selectedCaseCount: 2,
    selectedRunnerCount: 2,
    selectedExecutionCount: 4,
    scheduleMode: "serial" as const,
  };
  const suiteResult: SuiteRunResult = {
    suitePath: context.suitePath,
    startedAt: "2026-04-02T12:00:00.000Z",
    endedAt: "2026-04-02T12:01:42.000Z",
    durationMs: 102_000,
    outputDir: context.outputDir,
    cases: [
      createCaseResult({
        caseId: "case-a",
        runnerResults: [
          createRunnerResult({ runner: openRunner, passed: true, artifactDir: "x", totalTokens: 16_604 }),
          createRunnerResult({
            runner: codeRunner,
            passed: false,
            artifactDir: ".skillgym-results/run-1/case-a/code-main",
            totalTokens: 12_000,
          }),
        ],
      }),
      createCaseResult({
        caseId: "case-b",
        runnerResults: [
          createRunnerResult({ runner: openRunner, passed: true, artifactDir: "y", totalTokens: 17_200 }),
          createRunnerResult({ runner: codeRunner, passed: true, artifactDir: "z", totalTokens: 15_000 }),
        ],
      }),
    ],
    runners: [
      createRunnerSummary({ runner: openRunner, passedCases: 2, totalCases: 2, averageDurationMs: 18_200, averageTotalTokens: 16_902 }),
      createRunnerSummary({ runner: codeRunner, passedCases: 1, totalCases: 2, averageDurationMs: 19_300, averageTotalTokens: 13_500 }),
    ],
  };

  await reporter.onSuiteStart?.({ context, cases: [], runners: [openRunner, codeRunner], startedAt: suiteResult.startedAt });
  await reporter.onRunnerFinish?.({
    context,
    testCase: { id: "case-a", prompt: "", assert() {} },
    runner: codeRunner,
    result: suiteResult.cases[0]!.runnerResults[1]!,
    caseIndex: 1,
    totalCases: 2,
  });
  await reporter.onCaseFinish?.({ context, testCase: { id: "case-a", prompt: "", assert() {} }, result: suiteResult.cases[0]!, caseIndex: 1, totalCases: 2 });
  await reporter.onCaseFinish?.({ context, testCase: { id: "case-b", prompt: "", assert() {} }, result: suiteResult.cases[1]!, caseIndex: 2, totalCases: 2 });
  await reporter.onSuiteFinish?.({ context, result: suiteResult });

  const output = writes.join("");

  expect(output).toContain("Suite     examples/basic-suite.ts");
  expect(output).toContain("Runners   2");
  expect(output).toContain("Runs      4");
  expect(output).toContain("Runner: open-main");
  expect(output).toContain("Runner: code-main");
  expect(output).toContain("✓ case-a");
  expect(output).toContain("✗ case-a");
  expect(output).toContain("Passed runs    3/4");
  expect(output).toContain("75.0%");
  expect(output).toContain("Avg tok/run   15,201");
  expect(output).toContain("Failures");
  expect(output).toContain("AssertionError: expected skill to be loaded before command execution");
  expect(output).toContain("Artifacts: .skillgym-results/run-1/case-a/code-main");
});

test("standard reporter interactive mode renders queued, running, and finished runs", async () => {
  vi.useFakeTimers();
  const writes: string[] = [];
  const reporter = createStandardReporter({
    stdout: {
      isTTY: true,
      columns: 120,
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    },
    isInteractive: true,
    isUnicode: true,
  });

  const context = {
    isInteractive: true,
    cwd: "/workspace",
    workspaceMode: "shared" as const,
    suitePath: "examples/basic-suite.ts",
    outputDir: ".skillgym-results/run-1",
    selectedCaseCount: 2,
    selectedRunnerCount: 2,
    selectedExecutionCount: 4,
    scheduleMode: "parallel" as const,
  };

  const openRunner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const codeRunner = createRunnerInfo("code-main", { type: "codex", model: "gpt-5" });

  await reporter.onSuiteStart?.({
    context,
    cases: [
      { id: "skill-selection", prompt: "", assert() {} },
      { id: "snapshot-reuse", prompt: "", assert() {} },
    ],
    runners: [openRunner, codeRunner],
    startedAt: "2026-04-02T12:00:00.000Z",
  });

  const queuedOutput = writes.join("");

  expect(queuedOutput).toContain("\u001b[2m• skill-selection  /  open-main\u001b[22m");
  expect(queuedOutput).toContain("\u001b[2m• skill-selection  /  code-main\u001b[22m");
  expect(queuedOutput).toContain("\u001b[2m• snapshot-reuse   /  open-main\u001b[22m");
  expect(queuedOutput).toContain("\u001b[2m• snapshot-reuse   /  code-main\u001b[22m");

  await reporter.onRunnerStart?.({
    context,
    testCase: { id: "skill-selection", prompt: "", assert() {} },
    runner: openRunner,
    caseIndex: 1,
    totalCases: 2,
  });

  await reporter.onRunnerStart?.({
    context,
    testCase: { id: "snapshot-reuse", prompt: "", assert() {} },
    runner: codeRunner,
    caseIndex: 2,
    totalCases: 2,
  });

  const firstFrameOutput = writes.join("");

  expect(firstFrameOutput).toContain("\u001b[38;5;141m⠋\u001b[0m skill-selection  /  open-main");
  expect(firstFrameOutput).toContain("\u001b[38;5;141m⠋\u001b[0m snapshot-reuse   /  code-main");

  await vi.advanceTimersByTimeAsync(80);

  const animatedOutput = writes.join("");

  expect(animatedOutput).toContain("\u001b[38;5;141m⠙\u001b[0m skill-selection  /  open-main");
  expect(animatedOutput).toContain("\u001b[38;5;141m⠙\u001b[0m snapshot-reuse   /  code-main");

  await reporter.onRunnerFinish?.({
    context,
    testCase: { id: "skill-selection", prompt: "", assert() {} },
    runner: openRunner,
    result: createRunnerResult({ runner: openRunner, passed: true, artifactDir: "x", totalTokens: 10_000 }),
    caseIndex: 1,
    totalCases: 2,
  });

  await reporter.onRunnerFinish?.({
    context,
    testCase: { id: "snapshot-reuse", prompt: "", assert() {} },
    runner: codeRunner,
    result: createRunnerResult({ runner: codeRunner, passed: false, artifactDir: "y", totalTokens: 10_000 }),
    caseIndex: 2,
    totalCases: 2,
  });

  const finishedOutput = writes.join("");

  expect(finishedOutput).toContain("\u001b[32m✓ skill-selection  /  open-main\u001b[39m");
  expect(finishedOutput).toContain("\u001b[31m✗ snapshot-reuse   /  code-main\u001b[39m");
  expect(finishedOutput).toContain("\u001b[2K");
});

test("standard reporter prints warning line for non-serial schedules only", async () => {
  const parallelWrites: string[] = [];
  const serialWrites: string[] = [];
  const parallelReporter = createStandardReporter({
    stdout: {
      isTTY: false,
      columns: 120,
      write(chunk: string) {
        parallelWrites.push(chunk);
        return true;
      },
    },
    isInteractive: false,
    isUnicode: false,
  });
  const serialReporter = createStandardReporter({
    stdout: {
      isTTY: false,
      columns: 120,
      write(chunk: string) {
        serialWrites.push(chunk);
        return true;
      },
    },
    isInteractive: false,
    isUnicode: false,
  });
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });

  await parallelReporter.onSuiteStart?.({
    context: {
      isInteractive: false,
      cwd: "/workspace",
      workspaceMode: "shared",
      suitePath: "examples/basic-suite.ts",
      outputDir: ".skillgym-results/run-1",
      selectedCaseCount: 1,
      selectedRunnerCount: 1,
      selectedExecutionCount: 1,
      scheduleMode: "parallel",
    },
    cases: [],
    runners: [runner],
    startedAt: "2026-04-02T12:00:00.000Z",
  });
  await serialReporter.onSuiteStart?.({
    context: {
      isInteractive: false,
      cwd: "/workspace",
      workspaceMode: "shared",
      suitePath: "examples/basic-suite.ts",
      outputDir: ".skillgym-results/run-1",
      selectedCaseCount: 1,
      selectedRunnerCount: 1,
      selectedExecutionCount: 1,
      scheduleMode: "serial",
    },
    cases: [],
    runners: [runner],
    startedAt: "2026-04-02T12:00:00.000Z",
  });

  expect(parallelWrites.join("")).toContain("! Concurrent schedule: parallel runs may overlap in the same workspace.");
  expect(serialWrites.join("")).not.toContain("Concurrent schedule");
});

test("standard reporter prints friendly runner crash message with log path", async () => {
  const writes: string[] = [];
  const reporter = createStandardReporter({
    stdout: {
      isTTY: false,
      columns: 120,
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    },
    isInteractive: false,
    isUnicode: true,
  });

  const runner = createRunnerInfo("code-main", { type: "codex", model: "gpt-5.4" });
  const context = {
    isInteractive: false,
    cwd: "/workspace",
    workspaceMode: "shared" as const,
    suitePath: "examples/basic-suite.ts",
    outputDir: ".skillgym-results/run-1",
    selectedCaseCount: 1,
    selectedRunnerCount: 1,
    selectedExecutionCount: 1,
    scheduleMode: "serial" as const,
  };
  const suiteResult: SuiteRunResult = {
    suitePath: context.suitePath,
    startedAt: "2026-04-02T12:00:00.000Z",
    endedAt: "2026-04-02T12:01:42.000Z",
    durationMs: 102_000,
    outputDir: context.outputDir,
    cases: [
      createCaseResult({
        caseId: "case-a",
        runnerResults: [
          {
            ...createRunnerResult({
              runner,
              passed: false,
              artifactDir: ".skillgym-results/run-1/case-a/code-main",
              totalTokens: 12_000,
            }),
            failureType: "runner-crash",
          },
        ],
      }),
    ],
    runners: [
      createRunnerSummary({ runner, passedCases: 0, totalCases: 1, averageDurationMs: 19_300, averageTotalTokens: 13_500 }),
    ],
  };

  await reporter.onSuiteStart?.({ context, cases: [], runners: [runner], startedAt: suiteResult.startedAt });
  await reporter.onRunnerFinish?.({
    context,
    testCase: { id: "case-a", prompt: "", assert() {} },
    runner,
    result: suiteResult.cases[0]!.runnerResults[0]!,
    caseIndex: 1,
    totalCases: 1,
  });
  await reporter.onCaseFinish?.({ context, testCase: { id: "case-a", prompt: "", assert() {} }, result: suiteResult.cases[0]!, caseIndex: 1, totalCases: 1 });
  await reporter.onSuiteFinish?.({ context, result: suiteResult });

  const output = writes.join("");

  expect(output).toContain("Runner crashed. See .skillgym-results/run-1/case-a/code-main/stderr.log for details.");
  expect(output).toContain("Artifacts: .skillgym-results/run-1/case-a/code-main");
});

test("standard reporter suppresses shared-workspace warning for isolated mode", async () => {
  const writes: string[] = [];
  const reporter = createStandardReporter({
    stdout: {
      isTTY: false,
      columns: 120,
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    },
    isInteractive: false,
    isUnicode: false,
  });

  await reporter.onSuiteStart?.({
    context: {
      isInteractive: false,
      cwd: "/workspace",
      workspaceMode: "isolated",
      suitePath: "examples/basic-suite.ts",
      outputDir: ".skillgym-results/run-1",
      selectedCaseCount: 1,
      selectedRunnerCount: 1,
      selectedExecutionCount: 1,
      scheduleMode: "parallel",
    },
    cases: [],
    runners: [createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" })],
    startedAt: "2026-04-02T12:00:00.000Z",
  });

  expect(writes.join("")).not.toContain("Concurrent schedule");
  expect(writes.join("")).toContain("Workspace isolated per run");
});

function createCaseResult(options: {
  caseId: string;
  runnerResults: RunnerResult[];
}): CaseResult {
  return {
    caseId: options.caseId,
    passed: options.runnerResults.every((result) => result.passed),
    runnerResults: options.runnerResults,
  };
}

function createRunnerResult(options: {
  runner: RunnerInfo;
  passed: boolean;
  artifactDir: string;
  totalTokens: number;
}): RunnerResult {
  return {
    runner: options.runner,
    passed: options.passed,
    durationMs: 24_800,
    artifactDir: options.artifactDir,
    error: options.passed
      ? undefined
      : {
          name: "AssertionError",
          message: "expected skill to be loaded before command execution",
        },
    report: createSessionReport({
      runner: options.runner,
      usage: {
        totalTokens: options.totalTokens,
        inputTokens: 9_830,
        outputTokens: 1_104,
        reasoningTokens: 0,
        completionTokens: 1_104,
        inputChars: 10,
        outputChars: 5,
        reasoningChars: 0,
        source: {
          input: "provider",
          output: "provider",
          reasoning: "provider",
        },
      },
      files: {
        observedReads: ["a", "b", "c"],
        observedSkillReads: [],
      },
    }),
  };
}

function createRunnerSummary(options: {
  runner: RunnerInfo;
  totalCases: number;
  passedCases: number;
  averageDurationMs: number;
  averageTotalTokens: number;
}): RunnerSummary {
  return {
    runner: options.runner,
    totalCases: options.totalCases,
    passedCases: options.passedCases,
    successRate: options.passedCases / options.totalCases,
    averageDurationMs: options.averageDurationMs,
    averageTotalTokens: options.averageTotalTokens,
    averageCompletionTokens: undefined,
  };
}
