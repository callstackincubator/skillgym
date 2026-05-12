import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Case } from "../../src/domain/case.js";
import type { CaseResult, RunnerResult, SuiteRunResult } from "../../src/domain/result.js";
import type { RunnerInfo } from "../../src/domain/runner.js";
import type { SessionReport } from "../../src/domain/session-report.js";
import type { ReporterContext } from "../../src/reporters/contract.js";
import { createHtmlReporter } from "../../src/reporters/html.js";

const runner: RunnerInfo = {
  id: "claude-code@sonnet",
  pathKey: "claude-code",
  agent: { type: "claude-code", model: "claude-sonnet-4" },
};

const report: SessionReport = {
  runner,
  prompt: "fix the bug",
  usage: {
    inputTokens: 1200,
    outputTokens: 300,
    inputChars: 0,
    outputChars: 0,
    reasoningChars: 0,
    source: { input: "provider", output: "provider", reasoning: "derived" },
  },
  files: { observedReads: [], observedSkillReads: [] },
  detectedSkills: [],
  events: [],
  finalOutput: "I fixed the bug.",
  rawArtifacts: {},
};

function makeContext(suiteRunArtifactDir: string): ReporterContext {
  return {
    isInteractive: false,
    cwd: "/workspace",
    workspaceMode: "shared",
    suitePath: "examples/basic-suite.ts",
    suiteRunArtifactDir,
    selectedCaseCount: 1,
    selectedRunnerCount: 1,
    selectedExecutionCount: 1,
    scheduleMode: "serial",
    maxParallel: 1,
    declaredTags: [],
  };
}

describe("createHtmlReporter", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-html-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("writes report.html to suiteRunArtifactDir with pass counts and case details", async () => {
    const reporter = createHtmlReporter();

    const runnerResult: RunnerResult = {
      runner,
      passed: true,
      status: "passed",
      durationMs: 1500,
      executionArtifactDir: tempDir,
      artifactDir: tempDir,
      report,
    };
    const caseResult: CaseResult = {
      caseId: "write-hello",
      tags: [],
      passed: true,
      runnerResults: [runnerResult],
    };
    const testCase: Case = {
      id: "write-hello",
      prompt: "Write hello world",
      assert: () => {},
    };
    const suiteResult: SuiteRunResult = {
      suitePath: "examples/basic-suite.ts",
      startedAt: "2026-04-02T12:00:00.000Z",
      endedAt: "2026-04-02T12:01:00.000Z",
      durationMs: 60_000,
      suiteRunArtifactDir: tempDir,
      declaredTags: [],
      selectedTags: [],
      cases: [caseResult],
      runners: [],
    };

    await reporter.onCaseFinish?.({
      context: makeContext(tempDir),
      case: testCase,
      result: caseResult,
      caseIndex: 0,
      totalCases: 1,
    });
    await reporter.onSuiteFinish?.({
      context: makeContext(tempDir),
      result: suiteResult,
    });

    const html = await readFile(path.join(tempDir, "report.html"), "utf-8");
    expect(html).toContain("1/1 passed");
    expect(html).toContain("write-hello");
    expect(html).toContain("Write hello world");
    expect(html).toContain("PASS");
    expect(html).toContain("I fixed the bug.");
  });

  test("escapes HTML special characters in case id and prompt", async () => {
    const reporter = createHtmlReporter();

    const maliciousCase: Case = {
      id: "xss-<script>alert(1)</script>",
      prompt: 'Prompt with <b>bold</b> & "quotes"',
      assert: () => {},
    };
    const caseResult: CaseResult = {
      caseId: maliciousCase.id,
      tags: [],
      passed: false,
      runnerResults: [],
    };
    const suiteResult: SuiteRunResult = {
      suitePath: "examples/basic-suite.ts",
      startedAt: "2026-04-02T12:00:00.000Z",
      endedAt: "2026-04-02T12:00:05.000Z",
      durationMs: 5_000,
      suiteRunArtifactDir: tempDir,
      declaredTags: [],
      selectedTags: [],
      cases: [caseResult],
      runners: [],
    };

    await reporter.onCaseFinish?.({
      context: makeContext(tempDir),
      case: maliciousCase,
      result: caseResult,
      caseIndex: 0,
      totalCases: 1,
    });
    await reporter.onSuiteFinish?.({
      context: makeContext(tempDir),
      result: suiteResult,
    });

    const html = await readFile(path.join(tempDir, "report.html"), "utf-8");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;quotes&quot;");
  });

  test("two instances do not share case state", async () => {
    const reporterA = createHtmlReporter();
    const reporterB = createHtmlReporter();

    const testCase: Case = {
      id: "case-only-in-a",
      prompt: "only reporter A sees this",
      assert: () => {},
    };
    const caseResult: CaseResult = {
      caseId: testCase.id,
      tags: [],
      passed: true,
      runnerResults: [],
    };

    await reporterA.onCaseFinish?.({
      context: makeContext(tempDir),
      case: testCase,
      result: caseResult,
      caseIndex: 0,
      totalCases: 1,
    });

    const suiteResult: SuiteRunResult = {
      suitePath: "examples/basic-suite.ts",
      startedAt: "2026-04-02T12:00:00.000Z",
      endedAt: "2026-04-02T12:00:01.000Z",
      durationMs: 1_000,
      suiteRunArtifactDir: tempDir,
      declaredTags: [],
      selectedTags: [],
      cases: [],
      runners: [],
    };

    // reporterB never saw the case — its HTML should not contain it
    await reporterB.onSuiteFinish?.({
      context: makeContext(tempDir),
      result: suiteResult,
    });

    const html = await readFile(path.join(tempDir, "report.html"), "utf-8");
    expect(html).not.toContain("case-only-in-a");
  });
});
