import { expect, test } from "vitest";
import type { SuiteRunResult } from "../../src/index.js";
import { createJsonSummaryReporter } from "../../src/reporters/json-summary.js";
import { createRunnerInfo } from "../../src/runner/runner-info.js";

test("json-summary reporter omits session internals and prints summary on suite finish", async () => {
  const writes: string[] = [];
  const reporter = createJsonSummaryReporter({
    stdout: {
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    },
  });

  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const result: SuiteRunResult = {
    suitePath: "examples/basic-suite.ts",
    startedAt: "2026-04-02T12:00:00.000Z",
    endedAt: "2026-04-02T12:01:00.000Z",
    durationMs: 60_000,
    outputDir: ".skillgym-results/run-1",
    declaredTags: ["smoke", "gestures"],
    selectedTags: ["smoke"],
    cases: [
      {
        caseId: "case-a",
        tags: ["smoke"],
        passed: false,
        runnerResults: [
          {
            runner,
            passed: false,
            status: "failed",
            durationMs: 18_200,
            artifactDir: ".skillgym-results/run-1/case-a/open-main",
            failureType: "assertion",
            failureOrigin: "assertion",
            failureClass: {
              id: "missing-flag",
              label: "Missing required flag",
            },
            failureLogPath: ".skillgym-results/run-1/case-a/open-main/stderr.log",
            error: {
              name: "AssertionError",
              message: "expected skill to be loaded",
              stack: "AssertionError: expected skill to be loaded\n    at /workspace/suite.ts:10:5",
            },
            report: {
              runner,
              sessionId: "sess-abc123",
              prompt: "Do the thing",
              usage: {
                inputTokens: 1000,
                outputTokens: 200,
                reasoningTokens: 50,
                cacheTokens: 400,
                totalTokens: 1200,
                inputChars: 4000,
                outputChars: 800,
                reasoningChars: 200,
                source: { input: "provider", output: "provider", reasoning: "derived" },
              },
              files: {
                observedReads: ["/workspace/src/index.ts"],
                observedSkillReads: ["/workspace/.claude/skills/my-skill.md"],
              },
              detectedSkills: [
                { skill: "my-skill", confidence: "explicit", evidence: ["loaded skill"] },
              ],
              events: [
                {
                  type: "toolCall",
                  tool: "Read",
                  args: { file_path: "/workspace/src/index.ts" },
                  at: "2026-04-02T12:00:01.000Z",
                },
                {
                  type: "message",
                  role: "assistant",
                  text: "I'll read the file.",
                  at: "2026-04-02T12:00:02.000Z",
                },
              ],
              finalOutput: "Done.",
              startedAt: "2026-04-02T12:00:00.000Z",
              endedAt: "2026-04-02T12:00:18.000Z",
              durationMs: 18_200,
              rawArtifacts: {
                stdoutPath: ".skillgym-results/run-1/case-a/open-main/stdout.log",
                sessionPath: ".skillgym-results/run-1/case-a/open-main/session.json",
              },
            },
          },
        ],
      },
    ],
    runners: [
      {
        runner,
        totalCases: 1,
        passedCases: 0,
        successRate: 0,
        averageDurationMs: 18_200,
        averageTotalTokens: 1200,
      },
    ],
  };

  const context = {
    isInteractive: false,
    cwd: "/workspace",
    workspaceMode: "shared" as const,
    suitePath: result.suitePath,
    outputDir: result.outputDir,
    selectedCaseCount: 1,
    selectedRunnerCount: 1,
    selectedExecutionCount: 1,
    scheduleMode: "serial" as const,
    maxParallel: 1,
    tagFilter: ["smoke"],
    declaredTags: ["smoke", "gestures"],
  };

  await reporter.onSuiteStart?.({
    context,
    cases: [],
    runners: [runner],
    startedAt: result.startedAt,
  });
  await reporter.onSuiteFinish?.({ context, result });

  expect(writes).toHaveLength(1);
  const output = JSON.parse(writes[0]!);

  // top-level suite fields preserved
  expect(output.suitePath).toBe("examples/basic-suite.ts");
  expect(output.startedAt).toBe("2026-04-02T12:00:00.000Z");
  expect(output.durationMs).toBe(60_000);
  expect(output.outputDir).toBe(".skillgym-results/run-1");
  expect(output.declaredTags).toEqual(["smoke", "gestures"]);
  expect(output.selectedTags).toEqual(["smoke"]);

  // runner summaries preserved
  expect(output.runners).toHaveLength(1);
  expect(output.runners[0].runner.id).toBe("open-main");

  // case result preserved
  const caseResult = output.cases[0];
  expect(caseResult.caseId).toBe("case-a");
  expect(caseResult.tags).toEqual(["smoke"]);
  expect(caseResult.passed).toBe(false);

  // runner result: core fields preserved
  const runnerResult = caseResult.runnerResults[0];
  expect(runnerResult.runner.id).toBe("open-main");
  expect(runnerResult.passed).toBe(false);
  expect(runnerResult.durationMs).toBe(18_200);
  expect(runnerResult.artifactDir).toBe(".skillgym-results/run-1/case-a/open-main");
  expect(runnerResult.failureType).toBe("assertion");
  expect(runnerResult.failureOrigin).toBe("assertion");
  expect(runnerResult.failureClass).toEqual({
    id: "missing-flag",
    label: "Missing required flag",
  });

  // error: name and message preserved, stack omitted
  expect(runnerResult.error.name).toBe("AssertionError");
  expect(runnerResult.error.message).toBe("expected skill to be loaded");
  expect(runnerResult.error.stack).toBeUndefined();

  // usage preserved
  expect(runnerResult.usage.inputTokens).toBe(1000);
  expect(runnerResult.usage.totalTokens).toBe(1200);

  // session internals omitted
  expect(runnerResult.report).toBeUndefined();
  expect(runnerResult.failureLogPath).toBeUndefined();

  // no events, prompts, files, skills, artifacts
  const text = writes[0]!;
  expect(text).not.toContain("events");
  expect(text).not.toContain("toolCall");
  expect(text).not.toContain("sessionId");
  expect(text).not.toContain("prompt");
  expect(text).not.toContain("detectedSkills");
  expect(text).not.toContain("rawArtifacts");
  expect(text).not.toContain("finalOutput");
  expect(text).not.toContain("failureLogPath");
  expect(text).not.toContain("stack");
});

test("json-summary reporter is silent until suite finishes", async () => {
  const writes: string[] = [];
  const reporter = createJsonSummaryReporter({
    stdout: {
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    },
  });

  const runner = createRunnerInfo("r", { type: "codex", model: "gpt-5" });
  const context = {
    isInteractive: false,
    cwd: "/workspace",
    workspaceMode: "shared" as const,
    suitePath: "suite.ts",
    outputDir: ".out",
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
    testCase: { id: "c", prompt: "", assert() {} },
    runner,
    caseIndex: 1,
    totalCases: 1,
  });
  await reporter.onRunnerFinish?.({
    context,
    testCase: { id: "c", prompt: "", assert() {} },
    runner,
    result: {
      runner,
      passed: true,
      status: "passed",
      durationMs: 1000,
      artifactDir: ".out/c/r",
      report: {
        runner,
        prompt: "",
        usage: {
          inputChars: 0,
          outputChars: 0,
          reasoningChars: 0,
          source: { input: "provider", output: "provider", reasoning: "provider" },
        },
        files: { observedReads: [], observedSkillReads: [] },
        detectedSkills: [],
        events: [],
        finalOutput: "",
        rawArtifacts: {},
      },
    },
    caseIndex: 1,
    totalCases: 1,
  });

  expect(writes).toHaveLength(0);
});
