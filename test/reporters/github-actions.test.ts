import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import type { RunnerInfo, RunnerResult, RunnerSummary, SuiteRunResult } from "../../src/index.js";
import { createGitHubActionsReporter } from "../../src/reporters/github-actions.js";
import { createRunnerInfo } from "../../src/runner/runner-info.js";
import { createSessionReport } from "../helpers/session-report.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })));
});

test("github-actions reporter formats escaped annotations for failed runs", async () => {
  const writes: string[] = [];
  const runner = createRunnerInfo("code:main", { type: "codex", model: "gpt-5.4" });
  const reporter = createGitHubActionsReporter({
    stdout: {
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    },
    env: {},
  });

  await reporter.onSuiteFinish?.({ context: createContext(), result: createSuiteResult({ runner, caseId: "case,a", errorMessage: "boom,\n100%" }) });

  expect(writes.join("")).toContain("::error title=case%2Ca > code%3Amain,file=/workspace/examples/basic-suite.ts,line=14,col=15::");
  expect(writes.join("")).toContain("failure type: assertion%0Afailure origin: assertion%0Aerror: AssertionError: boom,%0A100%25");
  expect(writes.join("")).toContain("artifacts: .skillgym-results/run-1/case,a/code-main");
});

test("github-actions reporter includes file metadata from user stack frames", async () => {
  const writes: string[] = [];
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const reporter = createGitHubActionsReporter({
    stdout: {
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    },
    env: {},
  });

  await reporter.onSuiteFinish?.({ context: createContext(), result: createSuiteResult({ runner, caseId: "case-a" }) });

  expect(writes.join("")).toContain("file=/workspace/examples/basic-suite.ts,line=14,col=15");
});

test("github-actions reporter writes a job summary when GITHUB_STEP_SUMMARY is set", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-gha-"));
  tempDirs.push(tempDir);
  const summaryPath = path.join(tempDir, "summary.md");
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const reporter = createGitHubActionsReporter({
    stdout: { write() { return true; } },
    env: { GITHUB_STEP_SUMMARY: summaryPath },
  });

  await reporter.onSuiteFinish?.({ context: createContext(), result: createSuiteResult({ runner, caseId: "case-a" }) });

  const summary = await readFile(summaryPath, "utf8");
  expect(summary).toContain("## SkillGym Summary");
  expect(summary).toContain("- Suite: `examples/basic-suite.ts`");
  expect(summary).toContain("- Cases: 0 passed, 1 failed");
  expect(summary).toContain("- Runs: 0 passed, 1 failed");
  expect(summary).toContain("| `open-main` | 0/1 | 24s | 12000 |");
  expect(summary).toContain("- `case-a > open-main`; assertion; AssertionError: expected skill to be loaded before command execution; artifacts: `.skillgym-results/run-1/case-a/open-main`; log: `.skillgym-results/run-1/case-a/open-main/stderr.log`");
});

test("github-actions reporter skips job summary writes when GITHUB_STEP_SUMMARY is absent", async () => {
  const writes: string[] = [];
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const reporter = createGitHubActionsReporter({
    stdout: {
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    },
    env: {},
  });

  await expect(reporter.onSuiteFinish?.({ context: createContext(), result: createSuiteResult({ runner, caseId: "case-a" }) })).resolves.toBeUndefined();
  expect(writes.join("")).toContain("::error");
});

function createContext() {
  return {
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
}

function createSuiteResult(options: { runner: RunnerInfo; caseId: string; errorMessage?: string }): SuiteRunResult {
  const runnerResult = createFailedRunnerResult(options.runner, options.caseId, options.errorMessage);

  return {
    suitePath: "examples/basic-suite.ts",
    startedAt: "2026-04-02T12:00:00.000Z",
    endedAt: "2026-04-02T12:01:00.000Z",
    durationMs: 60_000,
    outputDir: ".skillgym-results/run-1",
    cases: [{ caseId: options.caseId, passed: false, runnerResults: [runnerResult] }],
    runners: [createRunnerSummary(options.runner)],
  };
}

function createFailedRunnerResult(runner: RunnerInfo, caseId: string, errorMessage = "expected skill to be loaded before command execution"): RunnerResult {
  return {
    runner,
    passed: false,
    durationMs: 24_800,
    artifactDir: `.skillgym-results/run-1/${caseId}/${runner.id.replace(/[:]/g, "-")}`,
    error: {
      name: "AssertionError",
      message: errorMessage,
      stack: [
        `AssertionError: ${errorMessage}`,
        "    at assert (/workspace/src/assertions/output.ts:88:10)",
        "    at Object.assert (/workspace/examples/basic-suite.ts:14:15)",
        "    at executeRunner (/workspace/src/runner/execute-runner.ts:91:7)",
      ].join("\n"),
    },
    failureType: "assertion",
    failureOrigin: "assertion",
    failureLogPath: `.skillgym-results/run-1/${caseId}/${runner.id.replace(/[:]/g, "-")}/stderr.log`,
    report: createSessionReport({
      runner,
      usage: {
        cacheTokens: 0,
        totalTokens: 12_000,
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
        observedReads: ["a"],
        observedSkillReads: [],
      },
    }),
  };
}

function createRunnerSummary(runner: RunnerInfo): RunnerSummary {
  return {
    runner,
    totalCases: 1,
    passedCases: 0,
    successRate: 0,
    averageDurationMs: 24_800,
    averageInputTokens: 9_830,
    averageOutputTokens: 1_104,
    averageReasoningTokens: 0,
    averageCacheTokens: 0,
    averageTotalTokens: 12_000,
  };
}
