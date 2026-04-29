import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import type { BenchmarkReporter, RunnerInfo, RunnerResult, SuiteRunResult, TestCase } from "../../src/index.js";
import type { RawRunArtifacts, RunHandle, RunInput, RunnerAdapter } from "../../src/domain/adapter.js";
import type { SnapshotRuntimeOptions } from "../../src/snapshots/store.js";
import { executeRunner } from "../../src/runner/execute-runner.js";
import { executeSuite } from "../../src/runner/execute-suite.js";
import { createRunnerInfo } from "../../src/runner/runner-info.js";
import { createSessionReport } from "../helpers/session-report.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })));
});

test("executeSuite with serial schedule preserves lifecycle order", async () => {
  const outputDir = await createTempDir();
  const calls: string[] = [];
  const reporter: BenchmarkReporter = {
    onSuiteStart(event) {
      calls.push(`suite:start:${event.context.scheduleMode}:${event.runners.map((runner) => runner.id).join(",")}`);
    },
    onCaseStart(event) {
      calls.push(`case:start:${event.testCase.id}`);
    },
    onRunnerStart(event) {
      calls.push(`runner:start:${event.testCase.id}:${event.runner.id}`);
    },
    onRunnerFinish(event) {
      calls.push(`runner:finish:${event.testCase.id}:${event.runner.id}:${event.result.passed}`);
    },
    onCaseFinish(event) {
      calls.push(`case:finish:${event.result.caseId}:${event.result.passed}`);
    },
    async onSuiteFinish(event) {
      const resultsPath = path.join(event.result.outputDir, "results.json");
      const contents = await readFile(resultsPath, "utf8");
      expect(contents).toContain('"cases"');
      expect(contents).toContain('"runners"');
      calls.push("suite:finish");
    },
  };

  const cases: TestCase[] = [
    { id: "alpha", prompt: "a", assert() {} },
    { id: "beta", prompt: "b", assert() {} },
  ];

  await executeSuite("./suite.ts", cases, {
    cwd: outputDir,
    outputDir,
    schedule: "serial",
    reporter,
    isInteractive: false,
      config: {
        runners: {
          open: { agent: { type: "opencode", model: "openai/gpt-5" } },
          code: { agent: { type: "codex", model: "gpt-5" } },
        },
      },
      executeRunnerFn: async (testCase, runner, _adapter, options) => createRunnerResult({
        caseId: testCase.id,
        runner,
        passed: !(testCase.id === "alpha" && runner.id === "code"),
        durationMs: runner.id === "open" ? 25 : 50,
        artifactDir: options.artifactDir,
        totalTokens: runner.id === "open" ? 101 : 202,
        outputTokens: runner.id === "open" ? 21 : 32,
        reasoningTokens: runner.id === "open" ? 2 : undefined,
        observedReads: runner.id === "open" ? 1 : 2,
    }),
  });

  expect(calls).toEqual([
    "suite:start:serial:open,code",
    "case:start:alpha",
    "runner:start:alpha:open",
    "runner:finish:alpha:open:true",
    "runner:start:alpha:code",
    "runner:finish:alpha:code:false",
    "case:finish:alpha:false",
    "case:start:beta",
    "runner:start:beta:open",
    "runner:finish:beta:open:true",
    "runner:start:beta:code",
    "runner:finish:beta:code:true",
    "case:finish:beta:true",
    "suite:finish",
  ]);
});

test("executeSuite with parallel schedule keeps final ordering stable while hooks finish by completion", async () => {
  const outputDir = await createTempDir();
  const calls: string[] = [];
  const pending = new Map<string, Deferred<RunnerResult>>();
  const reporter: BenchmarkReporter = {
    onCaseStart(event) {
      calls.push(`case:start:${event.testCase.id}`);
    },
    onRunnerStart(event) {
      calls.push(`runner:start:${event.testCase.id}:${event.runner.id}`);
    },
    onRunnerFinish(event) {
      calls.push(`runner:finish:${event.testCase.id}:${event.runner.id}`);
    },
    onCaseFinish(event) {
      calls.push(`case:finish:${event.testCase.id}`);
    },
  };
  const cases: TestCase[] = [
    { id: "alpha", prompt: "a", assert() {} },
    { id: "beta", prompt: "b", assert() {} },
  ];

  const suitePromise = executeSuite("./suite.ts", cases, {
    cwd: outputDir,
    outputDir,
    schedule: "parallel",
    reporter,
    isInteractive: false,
      config: {
        runners: {
          open: { agent: { type: "opencode", model: "openai/gpt-5" } },
          code: { agent: { type: "codex", model: "gpt-5" } },
        },
      },
    executeRunnerFn: async (testCase, runner, _adapter, options) => {
      const deferred = createDeferred<RunnerResult>();
      pending.set(`${testCase.id}:${runner.id}`, deferred);
      return deferred.promise;
    },
  });

  await waitFor(() => pending.size === 4);

  pending.get("beta:code")?.resolve(createRunnerResultForKey("beta", "code", outputDir, false));
  pending.get("alpha:open")?.resolve(createRunnerResultForKey("alpha", "open", outputDir, true));
  pending.get("beta:open")?.resolve(createRunnerResultForKey("beta", "open", outputDir, true));
  pending.get("alpha:code")?.resolve(createRunnerResultForKey("alpha", "code", outputDir, true));

  const result = await suitePromise;

  expect(calls.slice(0, 6)).toEqual(expect.arrayContaining([
    "case:start:alpha",
    "case:start:beta",
    "runner:start:alpha:open",
    "runner:start:alpha:code",
    "runner:start:beta:open",
    "runner:start:beta:code",
  ]));
  expect(calls.slice(6)).toEqual([
    "runner:finish:beta:code",
    "runner:finish:alpha:open",
    "runner:finish:beta:open",
    "runner:finish:alpha:code",
    "case:finish:beta",
    "case:finish:alpha",
  ]);
  expect(result.cases.map((caseResult) => caseResult.caseId)).toEqual(["alpha", "beta"]);
  expect(result.cases[0]?.runnerResults.map((runnerResult) => runnerResult.runner.id)).toEqual(["open", "code"]);
  expect(result.cases[1]?.runnerResults.map((runnerResult) => runnerResult.runner.id)).toEqual(["open", "code"]);
});

test("executeSuite with parallel schedule respects maxParallel", async () => {
  const outputDir = await createTempDir();
  const pending = new Map<string, Deferred<void>>();
  let active = 0;
  let maxActive = 0;

  const suitePromise = executeSuite("./suite.ts", [
    { id: "alpha", prompt: "a", assert() {} },
    { id: "beta", prompt: "b", assert() {} },
  ], {
    cwd: outputDir,
    outputDir,
    schedule: "parallel",
    maxParallel: 2,
    isInteractive: false,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
        code: { agent: { type: "codex", model: "gpt-5" } },
      },
    },
    executeRunnerFn: async (testCase, runner, _adapter, options) => {
      const key = `${testCase.id}:${runner.id}`;
      const deferred = createDeferred<void>();
      pending.set(key, deferred);
      active += 1;
      maxActive = Math.max(maxActive, active);

      try {
        await deferred.promise;
        return createRunnerResult({
          caseId: testCase.id,
          runner,
          passed: true,
          durationMs: 10,
          artifactDir: options.artifactDir,
          totalTokens: 100,
          outputTokens: 20,
          reasoningTokens: 2,
          observedReads: 1,
        });
      } finally {
        active -= 1;
      }
    },
  });

  await waitFor(() => pending.size === 2);
  expect(maxActive).toBe(2);

  pending.get("alpha:open")?.resolve();
  await waitFor(() => pending.size === 3);
  expect(maxActive).toBe(2);

  for (const deferred of pending.values()) {
    deferred.resolve();
  }

  await waitFor(() => pending.size === 4);
  pending.get("beta:code")?.resolve();

  await suitePromise;
  expect(maxActive).toBe(2);
});

test("executeSuite with isolated-by-runner runs serially within a runner and concurrently across runners", async () => {
  const outputDir = await createTempDir();
  const started: string[] = [];
  const activeByRunner = new Map<string, number>();
  const firstRunBlockers = new Map<string, Deferred<void>>([
    ["open", createDeferred<void>()],
    ["code", createDeferred<void>()],
  ]);
  let maxGlobalConcurrency = 0;

  const resultPromise = executeSuite("./suite.ts", [
    { id: "alpha", prompt: "a", assert() {} },
    { id: "beta", prompt: "b", assert() {} },
  ], {
    cwd: outputDir,
    outputDir,
    schedule: "isolated-by-runner",
    isInteractive: false,
      config: {
        runners: {
          open: { agent: { type: "opencode", model: "openai/gpt-5" } },
          code: { agent: { type: "codex", model: "gpt-5" } },
        },
      },
      executeRunnerFn: async (testCase, runner, _adapter, options) => {
      started.push(`${testCase.id}:${runner.id}`);
      activeByRunner.set(runner.id, (activeByRunner.get(runner.id) ?? 0) + 1);
      maxGlobalConcurrency = Math.max(maxGlobalConcurrency, [...activeByRunner.values()].reduce((sum, value) => sum + value, 0));

      try {
        if (testCase.id === "alpha") {
          await firstRunBlockers.get(runner.id)?.promise;
        }

        return createRunnerResult({
          caseId: testCase.id,
          runner,
          passed: true,
          durationMs: 10,
          artifactDir: options.artifactDir,
          totalTokens: 100,
          outputTokens: 20,
          reasoningTokens: 2,
          observedReads: 1,
        });
      } finally {
        activeByRunner.set(runner.id, (activeByRunner.get(runner.id) ?? 1) - 1);
      }
    },
  });

  await waitFor(() => started.length === 2);
  expect(started).toHaveLength(2);
  expect(started).toEqual(expect.arrayContaining(["alpha:open", "alpha:code"]));

  firstRunBlockers.get("open")?.resolve();
  await waitFor(() => started.includes("beta:open"));
  expect(started.indexOf("beta:open")).toBeGreaterThan(started.indexOf("alpha:open"));
  expect(started).not.toContain("beta:code");

  firstRunBlockers.get("code")?.resolve();
  const result = await resultPromise;

  expect(started.indexOf("beta:open")).toBeGreaterThan(started.indexOf("alpha:open"));
  expect(started.indexOf("beta:code")).toBeGreaterThan(started.indexOf("alpha:code"));
  expect(maxGlobalConcurrency).toBeGreaterThanOrEqual(2);
  expect(result.cases.map((caseResult) => caseResult.caseId)).toEqual(["alpha", "beta"]);
  expect(result.cases[0]?.runnerResults.map((runnerResult) => runnerResult.runner.id)).toEqual(["open", "code"]);
  expect(result.cases[1]?.runnerResults.map((runnerResult) => runnerResult.runner.id)).toEqual(["open", "code"]);
});

test("executeSuite with isolated-by-runner caps active runner lanes", async () => {
  const outputDir = await createTempDir();
  const started: string[] = [];
  const pending = new Map<string, Deferred<void>>();

  const suitePromise = executeSuite("./suite.ts", [
    { id: "alpha", prompt: "a", assert() {} },
    { id: "beta", prompt: "b", assert() {} },
  ], {
    cwd: outputDir,
    outputDir,
    schedule: "isolated-by-runner",
    maxParallel: 2,
    isInteractive: false,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
        code: { agent: { type: "codex", model: "gpt-5" } },
        cursor: { agent: { type: "cursor-agent", model: "composer-2-fast" } },
      },
    },
    executeRunnerFn: async (testCase, runner, _adapter, options) => {
      const key = `${testCase.id}:${runner.id}`;
      started.push(key);

      const shouldBlock = key === "alpha:open" || key === "beta:open" || key === "alpha:code";
      if (shouldBlock) {
        const deferred = createDeferred<void>();
        pending.set(key, deferred);
        await deferred.promise;
      }

      return createRunnerResult({
        caseId: testCase.id,
        runner,
        passed: true,
        durationMs: 10,
        artifactDir: options.artifactDir,
        totalTokens: 100,
        outputTokens: 20,
        reasoningTokens: 2,
        observedReads: 1,
      });
    },
  });

  await waitFor(() => started.length === 2);
  expect(started).toEqual(expect.arrayContaining(["alpha:open", "alpha:code"]));
  expect(started).not.toContain("alpha:cursor");

  pending.get("alpha:open")?.resolve();
  await waitFor(() => started.includes("beta:open"));
  expect(started).not.toContain("alpha:cursor");

  pending.get("beta:open")?.resolve();
  await waitFor(() => started.includes("alpha:cursor"));

  for (const deferred of pending.values()) {
    deferred.resolve();
  }

  await suitePromise;
});

test("executeSuite reports runner execution errors as failed runs", async () => {
  const outputDir = await createTempDir();
  const calls: string[] = [];
  const reporter: BenchmarkReporter = {
    onSuiteStart() {
      calls.push("suite:start");
    },
    onRunnerStart() {
      calls.push("runner:start");
    },
    onError(event) {
      calls.push(event.error instanceof Error ? event.error.message : String(event.error));
    },
  };

  const cases: TestCase[] = [{ id: "alpha", prompt: "a", assert() {} }];

  const result = await executeSuite("./suite.ts", cases, {
    cwd: outputDir,
    outputDir,
    reporter,
    isInteractive: false,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
      },
    },
    executeRunnerFn: async () => {
      throw new Error("boom");
    },
  });

  expect(result.cases[0]?.runnerResults[0]?.passed).toBe(false);
  expect(result.cases[0]?.runnerResults[0]?.failureType).toBe("runner-crash");
  expect(result.cases[0]?.runnerResults[0]?.error?.message).toBe("boom");
  expect(calls).toEqual(["suite:start", "runner:start"]);
});

test("executeSuite aggregates runner summaries from case-centric results", async () => {
  const outputDir = await createTempDir();
  let suiteResult: SuiteRunResult | undefined;

  const reporter: BenchmarkReporter = {
    onSuiteFinish(event) {
      suiteResult = event.result;
    },
  };

  const cases: TestCase[] = [
    { id: "alpha", prompt: "a", assert() {} },
    { id: "beta", prompt: "b", assert() {} },
  ];

  await executeSuite("./suite.ts", cases, {
    cwd: outputDir,
    outputDir,
    reporter,
    isInteractive: false,
      config: {
        runners: {
          open: { agent: { type: "opencode", model: "openai/gpt-5" } },
          code: { agent: { type: "codex", model: "gpt-5" } },
        },
      },
      executeRunnerFn: async (testCase, runner, _adapter, options) => {
        if (runner.id === "open") {
          return createRunnerResult({
            caseId: testCase.id,
            runner,
            passed: true,
            durationMs: testCase.id === "alpha" ? 20 : 40,
            artifactDir: options.artifactDir,
            totalTokens: testCase.id === "alpha" ? 200 : 300,
            outputTokens: 20,
            reasoningTokens: 5,
            observedReads: 1,
        });
      }

        return createRunnerResult({
          caseId: testCase.id,
          runner,
          passed: testCase.id === "beta",
          durationMs: testCase.id === "alpha" ? 50 : 70,
          artifactDir: options.artifactDir,
          totalTokens: 400,
          outputTokens: 30,
          reasoningTokens: undefined,
          observedReads: 2,
      });
    },
  });

  expect(suiteResult?.cases).toHaveLength(2);
  expect(suiteResult?.cases).toMatchObject([
    { caseId: "alpha", passed: false },
    { caseId: "beta", passed: true },
  ]);
  expect(suiteResult?.runners).toMatchObject([
    {
      runner: { id: "open" },
      totalCases: 2,
      passedCases: 2,
      successRate: 1,
      averageDurationMs: 30,
      averageInputTokens: 225,
      averageOutputTokens: 20,
      averageReasoningTokens: 5,
      averageCacheTokens: 0,
      averageTotalTokens: 250,
    },
    {
      runner: { id: "code" },
      totalCases: 2,
      passedCases: 1,
      successRate: 0.5,
      averageDurationMs: 60,
      averageInputTokens: 370,
      averageOutputTokens: 30,
      averageReasoningTokens: undefined,
      averageCacheTokens: 0,
      averageTotalTokens: 400,
    },
  ]);
});

test("executeSuite filters cases by tags with OR semantics and preserves result metadata", async () => {
  const outputDir = await createTempDir();
  const executed: string[] = [];
  const contexts: Array<{ tagFilter?: string[]; declaredTags: string[] }> = [];
  const cases: TestCase[] = [
    { id: "alpha", prompt: "a", tags: ["smoke", "fast", "smoke"], assert() {} },
    { id: "beta", prompt: "b", tags: ["regression"], assert() {} },
    { id: "gamma", prompt: "c", assert() {} },
  ];

  const result = await executeSuite("./suite.ts", cases, {
    cwd: outputDir,
    outputDir,
    tags: ["fast", "regression"],
    reporter: {
      onSuiteStart(event) {
        contexts.push({ tagFilter: event.context.tagFilter, declaredTags: event.context.declaredTags });
      },
    },
    isInteractive: false,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
      },
    },
    executeRunnerFn: async (testCase, runner, _adapter, options) => {
      executed.push(testCase.id);
      return createRunnerResult({
        caseId: testCase.id,
        runner,
        passed: true,
        durationMs: 10,
        artifactDir: options.artifactDir,
        totalTokens: 100,
        outputTokens: 20,
        observedReads: 1,
      });
    },
  });

  expect(executed).toEqual(["alpha", "beta"]);
  expect(contexts).toEqual([{ tagFilter: ["fast", "regression"], declaredTags: ["smoke", "fast", "regression"] }]);
  expect(result.declaredTags).toEqual(["smoke", "fast", "regression"]);
  expect(result.selectedTags).toEqual(["fast", "regression"]);
  expect(result.cases.map((caseResult) => ({ caseId: caseResult.caseId, tags: caseResult.tags }))).toEqual([
    { caseId: "alpha", tags: ["smoke", "fast"] },
    { caseId: "beta", tags: ["regression"] },
  ]);

  const saved = JSON.parse(await readFile(path.join(result.outputDir, "results.json"), "utf8")) as SuiteRunResult;
  expect(saved.declaredTags).toEqual(["smoke", "fast", "regression"]);
  expect(saved.selectedTags).toEqual(["fast", "regression"]);
  expect(saved.cases[0]?.tags).toEqual(["smoke", "fast"]);
});

test("executeSuite composes tag filters with case and runner filters", async () => {
  const outputDir = await createTempDir();
  const executed: string[] = [];
  const cases: TestCase[] = [
    { id: "alpha", prompt: "a", tags: ["smoke"], assert() {} },
    { id: "beta", prompt: "b", tags: ["smoke"], assert() {} },
  ];

  await executeSuite("./suite.ts", cases, {
    cwd: outputDir,
    outputDir,
    caseId: "beta",
    runner: "code",
    tags: ["smoke"],
    isInteractive: false,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
        code: { agent: { type: "codex", model: "gpt-5" } },
      },
    },
    executeRunnerFn: async (testCase, runner, _adapter, options) => {
      executed.push(`${testCase.id}:${runner.id}`);
      return createRunnerResult({
        caseId: testCase.id,
        runner,
        passed: true,
        durationMs: 10,
        artifactDir: options.artifactDir,
        totalTokens: 100,
        outputTokens: 20,
        observedReads: 1,
      });
    },
  });

  expect(executed).toEqual(["beta:code"]);
});

test("executeSuite reports active tag filters when no cases match", async () => {
  const outputDir = await createTempDir();
  let errorContext: { tagFilter?: string[]; declaredTags: string[] } | undefined;

  await expect(executeSuite("./suite.ts", [{ id: "alpha", prompt: "a", tags: ["smoke"], assert() {} }], {
    cwd: outputDir,
    outputDir,
    tags: ["missing"],
    reporter: {
      onError(event) {
        errorContext = {
          tagFilter: event.context?.tagFilter,
          declaredTags: event.context?.declaredTags ?? [],
        };
      },
    },
    isInteractive: false,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
      },
    },
  })).rejects.toThrow("No test cases matched the requested filters.");

  expect(errorContext).toEqual({ tagFilter: ["missing"], declaredTags: ["smoke"] });
});

test("executeSuite preserves unrelated snapshots and writes new entries for executed runs", async () => {
  const outputDir = await createTempDir();
  const snapshotsPath = path.join(outputDir, "skillgym.snapshots.json");
  await writeFile(
    snapshotsPath,
    JSON.stringify({
      version: 1,
      entries: {
        "other-case::other-runner": {
          caseId: "other-case",
          runnerId: "other-runner",
          metric: "totalTokens",
          value: 88,
          agentType: "opencode",
          updatedAt: "2026-04-04T12:00:00.000Z",
        },
      },
    }, null, 2),
    "utf8",
  );

  await executeSuite("./suite.ts", [{ id: "alpha", prompt: "a", assert() {} }], {
    cwd: outputDir,
    outputDir,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
      },
    },
    snapshots: createSnapshotRuntime(snapshotsPath),
    executeRunnerFn: async (testCase, runner, _adapter, options) => executeRunner(
      testCase,
      runner,
      createSnapshotAdapter(runner, 150),
      options,
    ),
  });

  const saved = JSON.parse(await readFile(snapshotsPath, "utf8")) as {
    entries: Record<string, { value: number }>;
  };

  expect(saved.entries["other-case::other-runner"]?.value).toBe(88);
  expect(saved.entries["alpha::open"]?.value).toBe(150);
});

test("executeSuite refreshes matching snapshots in update mode", async () => {
  const outputDir = await createTempDir();
  const snapshotsPath = path.join(outputDir, "skillgym.snapshots.json");
  await writeFile(
    snapshotsPath,
    JSON.stringify({
      version: 1,
      entries: {
        "alpha::open": {
          caseId: "alpha",
          runnerId: "open",
          metric: "totalTokens",
          value: 100,
          agentType: "opencode",
          updatedAt: "2026-04-04T12:00:00.000Z",
        },
      },
    }, null, 2),
    "utf8",
  );

  await executeSuite("./suite.ts", [{ id: "alpha", prompt: "a", assert() {} }], {
    cwd: outputDir,
    outputDir,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
      },
    },
    snapshots: {
      ...createSnapshotRuntime(snapshotsPath),
      updateSnapshots: true,
    },
    executeRunnerFn: async (testCase, runner, _adapter, options) => executeRunner(
      testCase,
      runner,
      createSnapshotAdapter(runner, 222),
      options,
    ),
  });

  const saved = JSON.parse(await readFile(snapshotsPath, "utf8")) as {
    entries: Record<string, { value: number }>;
  };

  expect(saved.entries["alpha::open"]?.value).toBe(222);
});

function createRunnerResultForKey(caseId: string, runnerId: string, outputDir: string, passed: boolean): RunnerResult {
  const runner = createRunnerInfo(
    runnerId,
    runnerId === "code"
      ? { type: "codex", model: "gpt-5" }
      : { type: "opencode", model: "openai/gpt-5" },
  );
  return createRunnerResult({
    caseId,
    runner,
    passed,
    durationMs: 10,
    artifactDir: path.join(outputDir, caseId, runner.pathKey),
    totalTokens: 100,
    outputTokens: 20,
    reasoningTokens: 2,
    observedReads: 1,
  });
}

function createRunnerResult(options: {
  caseId: string;
  runner: RunnerInfo;
  passed: boolean;
  durationMs: number;
  artifactDir: string;
  totalTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  observedReads: number;
}): RunnerResult {
  const inputTokens = options.totalTokens === undefined
    ? undefined
    : options.totalTokens - options.outputTokens - (options.reasoningTokens ?? 0);

  return {
    runner: options.runner,
    passed: options.passed,
    durationMs: options.durationMs,
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
        inputTokens,
        outputTokens: options.outputTokens,
        reasoningTokens: options.reasoningTokens,
        cacheTokens: 0,
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
        observedReads: Array.from({ length: options.observedReads }, (_, index) => `file-${index}`),
        observedSkillReads: [],
      },
    }),
  };
}

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-suite-"));
  tempDirs.push(tempDir);
  return tempDir;
}

function createSnapshotRuntime(filePath: string): SnapshotRuntimeOptions {
  return {
    enabled: true,
    updateSnapshots: false,
    path: filePath,
    config: {
      metric: "totalTokens",
      tolerance: {
        absolute: 20,
      },
    },
  };
}

function createSnapshotAdapter(runner: RunnerInfo, totalTokens: number): RunnerAdapter {
  return {
    async run(input: RunInput): Promise<RunHandle> {
      return {
        startedAt: "2026-04-03T10:00:00.000Z",
        endedAt: "2026-04-03T10:00:01.000Z",
        durationMs: 1_000,
        stdoutPath: path.join(input.artifactsDir, "stdout.log"),
        stderrPath: path.join(input.artifactsDir, "stderr.log"),
      };
    },
    async collect(handle: RunHandle): Promise<RawRunArtifacts> {
      return {
        stdout: "",
        stderr: "",
        stdoutPath: handle.stdoutPath,
        stderrPath: handle.stderrPath,
        startedAt: handle.startedAt,
        endedAt: handle.endedAt,
        durationMs: handle.durationMs,
      };
    },
    async normalize(input: RunInput) {
      return createSessionReport({
        runner,
        prompt: input.prompt,
        usage: {
          totalTokens,
          inputTokens: totalTokens,
          outputTokens: 20,
          reasoningTokens: 2,
          cacheTokens: 0,
          inputChars: 10,
          outputChars: 5,
          reasoningChars: 0,
          source: {
            input: "provider",
            output: "provider",
            reasoning: "provider",
          },
        },
      });
    },
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean, attempts = 50): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for condition");
}
