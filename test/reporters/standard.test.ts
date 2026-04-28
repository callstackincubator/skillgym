import { afterEach, expect, test, vi } from "vitest";
import type { CaseResult, RunnerInfo, RunnerResult, RunnerSummary, SuiteRunResult } from "../../src/index.js";
import { createStandardReporter } from "../../src/reporters/standard.js";
import { createRunnerInfo } from "../../src/runner/runner-info.js";
import { createSessionReport } from "../helpers/session-report.js";

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
  expect(output).toContain("case                       time           tokens in / out / reason / cache / billable");
  expect(output).toContain("✓ case-a");
  expect(output).toContain("✗ case-a");
  expect(output).toContain("Cases       1 failed | 1 passed (2)");
  expect(output).toContain("Runs        1 failed | 3 passed (4)");
  expect(output).toContain("Statuses    0 expected failures | 0 unexpected passes");
  expect(output).toContain("Duration    1m 42s");
  expect(output).toContain("9,830 / 1,104 / 0 / 7,233 / 16,604");
  expect(output).toContain("9,830 / 1,104 / 0 / 7,233 / 12,000");
  expect(output).toContain("Tokens      9,830 / 1,104 / 0 / 7,233 / 15,201");
  expect(output).toContain("Output      .skillgym-results/run-1");
  expect(output).toContain("Failures");
  expect(output).toContain("✗ case-a > code-main (codex, gpt-5.4)");
  expect(output).toContain("AssertionError: expected skill to be loaded before command execution");
  expect(output).toContain("at /workspace/examples/basic-suite.ts:14:15");
  expect(output).not.toContain("skillgym could not complete the run");
  expect(output).not.toContain("Run did not complete because the runner crashed");
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

  expect(queuedOutput).toContain("\u001b[2m• skill-selection  /  open-main (opencode, openai/gpt-5)\u001b[22m");
  expect(queuedOutput).toContain("\u001b[2m• skill-selection  /  code-main (codex, gpt-5)\u001b[22m");
  expect(queuedOutput).toContain("\u001b[2m• snapshot-reuse   /  open-main (opencode, openai/gpt-5)\u001b[22m");
  expect(queuedOutput).toContain("\u001b[2m• snapshot-reuse   /  code-main (codex, gpt-5)\u001b[22m");

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

  expect(firstFrameOutput).toContain("\u001b[38;5;141m⠋\u001b[0m skill-selection  /  open-main\u001b[2m (opencode, openai/gpt-5)\u001b[22m");
  expect(firstFrameOutput).toContain("\u001b[38;5;141m⠋\u001b[0m snapshot-reuse   /  code-main\u001b[2m (codex, gpt-5)\u001b[22m");

  await vi.advanceTimersByTimeAsync(80);

  const animatedOutput = writes.join("");

  expect(animatedOutput).toContain("\u001b[38;5;141m⠙\u001b[0m skill-selection  /  open-main\u001b[2m (opencode, openai/gpt-5)\u001b[22m");
  expect(animatedOutput).toContain("\u001b[38;5;141m⠙\u001b[0m snapshot-reuse   /  code-main\u001b[2m (codex, gpt-5)\u001b[22m");

  await reporter.onRunnerFinish?.({
    context,
    testCase: { id: "skill-selection", prompt: "", assert() {} },
    runner: openRunner,
    result: createRunnerResult({ runner: openRunner, passed: true, status: "expected-failed", artifactDir: "x", totalTokens: 10_000 }),
    caseIndex: 1,
    totalCases: 2,
  });

  await reporter.onRunnerFinish?.({
    context,
    testCase: { id: "snapshot-reuse", prompt: "", assert() {} },
    runner: codeRunner,
    result: createRunnerResult({ runner: codeRunner, passed: false, status: "unexpected-passed", artifactDir: "y", totalTokens: 10_000 }),
    caseIndex: 2,
    totalCases: 2,
  });

  const finishedOutput = writes.join("");

  expect(finishedOutput).toContain("\u001b[32m✓ skill-selection  /  open-main expected failure\u001b[39m\u001b[2m (opencode, openai/gpt-5)\u001b[22m");
  expect(finishedOutput).toContain("\u001b[31m✗ snapshot-reuse   /  code-main unexpected pass\u001b[39m\u001b[2m (codex, gpt-5)\u001b[22m");
  expect(finishedOutput).toContain("\u001b[2K");
});

test("standard reporter labels expected failures and unexpected passes", async () => {
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
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const context = {
    isInteractive: false,
    cwd: "/workspace",
    workspaceMode: "shared" as const,
    suitePath: "examples/basic-suite.ts",
    outputDir: ".skillgym-results/run-1",
    selectedCaseCount: 2,
    selectedRunnerCount: 1,
    selectedExecutionCount: 2,
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
        caseId: "known-gap",
        runnerResults: [createRunnerResult({ runner, passed: true, status: "expected-failed", artifactDir: "x", totalTokens: 12_000 })],
      }),
      createCaseResult({
        caseId: "stale-gap",
        runnerResults: [createRunnerResult({ runner, passed: false, status: "unexpected-passed", artifactDir: "y", totalTokens: 12_000 })],
      }),
    ],
    runners: [createRunnerSummary({ runner, passedCases: 1, totalCases: 2, averageDurationMs: 24_800, averageTotalTokens: 12_000 })],
  };

  await reporter.onSuiteStart?.({ context, cases: [], runners: [runner], startedAt: suiteResult.startedAt });
  await reporter.onRunnerFinish?.({
    context,
    testCase: { id: "stale-gap", prompt: "", assert() {} },
    runner,
    result: suiteResult.cases[1]!.runnerResults[0]!,
    caseIndex: 2,
    totalCases: 2,
  });
  await reporter.onCaseFinish?.({ context, testCase: { id: "known-gap", prompt: "", assert() {} }, result: suiteResult.cases[0]!, caseIndex: 1, totalCases: 2 });
  await reporter.onCaseFinish?.({ context, testCase: { id: "stale-gap", prompt: "", assert() {} }, result: suiteResult.cases[1]!, caseIndex: 2, totalCases: 2 });
  await reporter.onSuiteFinish?.({ context, result: suiteResult });

  const output = writes.join("");
  expect(output).toContain("expected failure");
  expect(output).toContain("unexpected pass");
  expect(output).toContain("Statuses    1 expected failures | 1 unexpected passes");
  expect(output).toContain("Failures");
  expect(output).toContain("✗ stale-gap > open-main");
  expect(output).not.toContain("known-gap > open-main");
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
             failureOrigin: "runner",
             failureLogPath: ".skillgym-results/run-1/case-a/code-main/stderr.log",
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

  expect(output).toContain("✗ case-a > code-main (codex, gpt-5.4)");
  expect(output).toContain("Run did not complete because the runner crashed.");
  expect(output).toContain("AssertionError: expected skill to be loaded before command execution");
  expect(output).toContain("Log: .skillgym-results/run-1/case-a/code-main/stderr.log");
  expect(output).toContain("Artifacts: .skillgym-results/run-1/case-a/code-main");
});

test("standard reporter points workspace bootstrap failures to bootstrap logs", async () => {
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

  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const context = {
    isInteractive: false,
    cwd: "/workspace",
    workspaceMode: "isolated" as const,
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
              artifactDir: ".skillgym-results/run-1/case-a/open-main",
              totalTokens: 12_000,
            }),
            error: {
              name: "Error",
              message: "Workspace bootstrap failed: sh ./bootstrap.sh (exit 4)",
            },
            failureType: "runner-crash",
            failureOrigin: "workspace-bootstrap",
            failureLogPath: ".skillgym-results/run-1/case-a/open-main/bootstrap.stderr.log",
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

  expect(output).toContain("✗ case-a > open-main (opencode, openai/gpt-5)");
  expect(output).toContain("Workspace bootstrap failed.");
  expect(output).toContain("Error: Workspace bootstrap failed: sh ./bootstrap.sh (exit 4)");
  expect(output).toContain("Log: .skillgym-results/run-1/case-a/open-main/bootstrap.stderr.log");
  expect(output).toContain("Artifacts: .skillgym-results/run-1/case-a/open-main");
});

test("standard reporter renders max-steps failures with a clear message", async () => {
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

  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
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
              artifactDir: ".skillgym-results/run-1/case-a/open-main",
              totalTokens: 12_000,
            }),
            error: {
              name: "MaxStepsExceededError",
              message: "Exceeded maxSteps: observed 2 steps with limit 1 for runner \"open-main\" (opencode). Agent terminated by skillgym. Raw output preserved.",
            },
            failureType: "runner-crash",
            failureOrigin: "max-steps",
            failureLogPath: ".skillgym-results/run-1/case-a/open-main/stderr.log",
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

  expect(output).toContain("Run stopped: exceeded maxSteps (best-effort). Raw output was preserved in the run artifacts for debugging.");
  expect(output).toContain("MaxStepsExceededError: Exceeded maxSteps: observed 2 steps with limit 1");
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
  status?: RunnerResult["status"];
  artifactDir: string;
  totalTokens: number;
}): RunnerResult {
  return {
    runner: options.runner,
    passed: options.passed,
    status: options.status ?? (options.passed ? "passed" : "failed"),
    durationMs: 24_800,
    artifactDir: options.artifactDir,
    error: options.passed || options.status === "unexpected-passed"
        ? undefined
        : {
          name: "AssertionError",
          message: "expected skill to be loaded before command execution",
          stack: [
            "AssertionError: expected skill to be loaded before command execution",
            "    at assert (/workspace/src/assertions/output.ts:88:10)",
            "    at Object.assert (/workspace/examples/basic-suite.ts:14:15)",
            "    at executeRunner (/workspace/src/runner/execute-runner.ts:91:7)",
          ].join("\n"),
        },
    failureType: options.passed || options.status === "unexpected-passed" ? undefined : "assertion",
    failureOrigin: options.passed || options.status === "unexpected-passed" ? undefined : "assertion",
    report: createSessionReport({
      runner: options.runner,
      usage: {
        cacheTokens: 7_233,
        totalTokens: options.totalTokens,
        inputTokens: 9_830,
        outputTokens: 1_104,
        reasoningTokens: 0,
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
    averageInputTokens: 9_830,
    averageOutputTokens: 1_104,
    averageReasoningTokens: 0,
    averageCacheTokens: 7_233,
    averageTotalTokens: options.averageTotalTokens,
  };
}
