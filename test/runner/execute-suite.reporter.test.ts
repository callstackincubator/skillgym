import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import type {
  BenchmarkReporter,
  RunnerInfo,
  RunnerResult,
  SuiteRunResult,
  Case,
} from "../../src/index.js";
import type {
  RawRunArtifacts,
  RunHandle,
  RunInput,
  RunnerAdapter,
} from "../../src/domain/adapter.js";
import type { SnapshotRuntimeOptions } from "../../src/snapshots/store.js";
import { executeRunner } from "../../src/runner/execute-runner.js";
import { classifyExpectedFailure, executeSuite } from "../../src/runner/execute-suite.js";
import { createRunnerInfo } from "../../src/runner/runner-info.js";
import { createSessionReport } from "../helpers/session-report.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })),
  );
});

test("executeSuite with serial schedule preserves lifecycle order", async () => {
  const suiteRunArtifactDir = await createTempDir();
  const calls: string[] = [];
  const reporter: BenchmarkReporter = {
    onSuiteStart(event) {
      calls.push(
        `suite:start:${event.context.scheduleMode}:${event.runners.map((runner) => runner.id).join(",")}`,
      );
    },
    onCaseStart(event) {
      calls.push(`case:start:${event.case.id}`);
    },
    onRunnerStart(event) {
      calls.push(`runner:start:${event.case.id}:${event.runner.id}`);
    },
    onRunnerFinish(event) {
      calls.push(`runner:finish:${event.case.id}:${event.runner.id}:${event.result.passed}`);
    },
    onCaseFinish(event) {
      calls.push(`case:finish:${event.result.caseId}:${event.result.passed}`);
    },
    async onSuiteFinish(event) {
      const resultsPath = path.join(event.result.suiteRunArtifactDir, "results.json");
      const contents = await readFile(resultsPath, "utf8");
      expect(contents).toContain('"cases"');
      expect(contents).toContain('"runners"');
      calls.push("suite:finish");
    },
  };

  const cases: Case[] = [
    { id: "alpha", prompt: "a", assert() {} },
    { id: "beta", prompt: "b", assert() {} },
  ];

  await executeSuite("./suite.ts", cases, {
    cwd: suiteRunArtifactDir,
    suiteRunArtifactDir,
    schedule: "serial",
    reporter,
    isInteractive: false,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
        code: { agent: { type: "codex", model: "gpt-5" } },
      },
    },
    executeRunnerFn: async (case_, runner, _adapter, options) =>
      createRunnerResult({
        caseId: case_.id,
        runner,
        passed: !(case_.id === "alpha" && runner.id === "code"),
        durationMs: runner.id === "open" ? 25 : 50,
        executionArtifactDir: options.artifactDir,
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
  const suiteRunArtifactDir = await createTempDir();
  const calls: string[] = [];
  const pending = new Map<string, Deferred<RunnerResult>>();
  const reporter: BenchmarkReporter = {
    onCaseStart(event) {
      calls.push(`case:start:${event.case.id}`);
    },
    onRunnerStart(event) {
      calls.push(`runner:start:${event.case.id}:${event.runner.id}`);
    },
    onRunnerFinish(event) {
      calls.push(`runner:finish:${event.case.id}:${event.runner.id}`);
    },
    onCaseFinish(event) {
      calls.push(`case:finish:${event.case.id}`);
    },
  };
  const cases: Case[] = [
    { id: "alpha", prompt: "a", assert() {} },
    { id: "beta", prompt: "b", assert() {} },
  ];

  const suitePromise = executeSuite("./suite.ts", cases, {
    cwd: suiteRunArtifactDir,
    suiteRunArtifactDir,
    schedule: "parallel",
    reporter,
    isInteractive: false,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
        code: { agent: { type: "codex", model: "gpt-5" } },
      },
    },
    executeRunnerFn: async (case_, runner, _adapter, options) => {
      const deferred = createDeferred<RunnerResult>();
      pending.set(`${case_.id}:${runner.id}`, deferred);
      return deferred.promise;
    },
  });

  await waitFor(() => pending.size === 1);
  expect([...pending.keys()]).toEqual(["alpha:open"]);

  pending
    .get("alpha:open")
    ?.resolve(createRunnerResultForKey("alpha", "open", suiteRunArtifactDir, true));
  await waitFor(() => pending.size === 2);
  pending
    .get("alpha:code")
    ?.resolve(createRunnerResultForKey("alpha", "code", suiteRunArtifactDir, true));

  await waitFor(() => pending.size === 4);
  pending
    .get("beta:code")
    ?.resolve(createRunnerResultForKey("beta", "code", suiteRunArtifactDir, false));
  pending
    .get("beta:open")
    ?.resolve(createRunnerResultForKey("beta", "open", suiteRunArtifactDir, true));

  const result = await suitePromise;

  expect(calls.slice(0, 6)).toEqual([
    "case:start:alpha",
    "runner:start:alpha:open",
    "runner:finish:alpha:open",
    "runner:start:alpha:code",
    "runner:finish:alpha:code",
    "case:finish:alpha",
  ]);
  expect(calls.slice(6, 9)).toEqual(
    expect.arrayContaining(["case:start:beta", "runner:start:beta:open", "runner:start:beta:code"]),
  );
  expect(calls.slice(9, 11)).toEqual(
    expect.arrayContaining(["runner:finish:beta:code", "runner:finish:beta:open"]),
  );
  expect(calls[11]).toBe("case:finish:beta");
  expect(result.cases.map((caseResult) => caseResult.caseId)).toEqual(["alpha", "beta"]);
  expect(result.cases[0]?.runnerResults.map((runnerResult) => runnerResult.runner.id)).toEqual([
    "open",
    "code",
  ]);
  expect(result.cases[1]?.runnerResults.map((runnerResult) => runnerResult.runner.id)).toEqual([
    "open",
    "code",
  ]);
});

test("executeSuite blocks remaining executions for a runner after initial model rejection", async () => {
  const suiteRunArtifactDir = await createTempDir();
  const started: string[] = [];

  const result = await executeSuite(
    "./suite.ts",
    [
      { id: "alpha", prompt: "a", assert() {} },
      { id: "beta", prompt: "b", assert() {} },
      { id: "gamma", prompt: "c", assert() {} },
    ],
    {
      cwd: suiteRunArtifactDir,
      suiteRunArtifactDir,
      schedule: "parallel",
      isInteractive: false,
      config: {
        runners: {
          open: { agent: { type: "opencode", model: "openai/gpt-5" } },
          code: { agent: { type: "codex", model: "gpt-5" } },
        },
      },
      executeRunnerFn: async (case_, runner, _adapter, options) => {
        started.push(`${case_.id}:${runner.id}`);

        if (case_.id === "alpha" && runner.id === "code") {
          await writeFile(
            path.join(options.artifactDir, "stdout.log"),
            '{"type":"error","message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The \'gpt-5\' model is not supported when using Codex with a ChatGPT account.\"}}"}\n',
            "utf8",
          );
          await writeFile(path.join(options.artifactDir, "stderr.log"), "", "utf8");

          return {
            ...createRunnerResultForKey(case_.id, runner.id, suiteRunArtifactDir, false),
            executionArtifactDir: options.artifactDir,
            error: {
              name: "Error",
              message: "Command failed: codex",
            },
            failureOrigin: "runner",
            failureClass: { id: "runner-crash", label: "Runner crash" },
          };
        }

        return {
          ...createRunnerResultForKey(case_.id, runner.id, suiteRunArtifactDir, true),
          executionArtifactDir: options.artifactDir,
        };
      },
    },
  );

  expect(started.slice(0, 2)).toEqual(["alpha:open", "alpha:code"]);
  expect(started.slice(2)).toEqual(expect.arrayContaining(["beta:open", "gamma:open"]));
  expect(started).not.toContain("beta:code");
  expect(started).not.toContain("gamma:code");
  expect(result.cases[0]?.runnerResults.find((entry) => entry.runner.id === "code")).toMatchObject({
    passed: false,
    failureOrigin: "model-rejected",
  });
  expect(result.cases[1]?.runnerResults.find((entry) => entry.runner.id === "code")).toMatchObject({
    passed: false,
    failureOrigin: "model-rejected",
  });
  expect(result.cases[2]?.runnerResults.find((entry) => entry.runner.id === "code")).toMatchObject({
    passed: false,
    failureOrigin: "model-rejected",
  });
  expect(
    result.cases[1]?.runnerResults.find((entry) => entry.runner.id === "code")?.error?.message,
  ).toContain('Runner rejected configured model "gpt-5" during initial execution.');
});

test("executeSuite with parallel schedule respects maxParallel", async () => {
  const suiteRunArtifactDir = await createTempDir();
  const pending = new Map<string, Deferred<void>>();
  let active = 0;
  let maxActive = 0;

  const suitePromise = executeSuite(
    "./suite.ts",
    [
      { id: "alpha", prompt: "a", assert() {} },
      { id: "beta", prompt: "b", assert() {} },
    ],
    {
      cwd: suiteRunArtifactDir,
      suiteRunArtifactDir,
      schedule: "parallel",
      maxParallel: 2,
      isInteractive: false,
      config: {
        runners: {
          open: { agent: { type: "opencode", model: "openai/gpt-5" } },
          code: { agent: { type: "codex", model: "gpt-5" } },
        },
      },
      executeRunnerFn: async (case_, runner, _adapter, options) => {
        const key = `${case_.id}:${runner.id}`;
        const deferred = createDeferred<void>();
        pending.set(key, deferred);
        active += 1;
        maxActive = Math.max(maxActive, active);

        try {
          await deferred.promise;
          return createRunnerResult({
            caseId: case_.id,
            runner,
            passed: true,
            durationMs: 10,
            executionArtifactDir: options.artifactDir,
            totalTokens: 100,
            outputTokens: 20,
            reasoningTokens: 2,
            observedReads: 1,
          });
        } finally {
          active -= 1;
        }
      },
    },
  );

  await waitFor(() => pending.size === 1);
  expect(maxActive).toBe(1);

  pending.get("alpha:open")?.resolve();
  await waitFor(() => pending.size === 2);

  pending.get("alpha:code")?.resolve();
  await waitFor(() => pending.size === 4);
  expect(maxActive).toBe(2);

  pending.get("beta:open")?.resolve();
  pending.get("beta:code")?.resolve();

  await suitePromise;
  expect(maxActive).toBe(2);
});

test("executeSuite retries only failed executions and preserves session artifacts", async () => {
  const suiteRunArtifactDir = await createTempDir();
  const attemptsByRun = new Map<string, number>();
  const runnerPathKey = createRunnerInfo("open", {
    type: "opencode",
    model: "openai/gpt-5",
  }).pathKey;

  const result = await executeSuite("./suite.ts", [{ id: "flaky", prompt: "a", assert() {} }], {
    cwd: suiteRunArtifactDir,
    suiteRunArtifactDir,
    retryFailed: 2,
    isInteractive: false,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
      },
    },
    executeRunnerFn: async (case_, runner, _adapter, options) => {
      const key = `${case_.id}:${runner.id}`;
      const session = (attemptsByRun.get(key) ?? 0) + 1;
      attemptsByRun.set(key, session);

      return createRunnerResult({
        caseId: case_.id,
        runner,
        passed: session >= 2,
        durationMs: session * 10,
        executionArtifactDir: options.artifactDir,
        totalTokens: 100 * session,
        outputTokens: 20,
        observedReads: 1,
      });
    },
  });

  const runnerResult = result.cases[0]!.runnerResults[0]!;
  expect(attemptsByRun.get("flaky:open")).toBe(2);
  expect(runnerResult).toMatchObject({
    passed: true,
    session: 2,
    executionArtifactDir: path.join(result.suiteRunArtifactDir, "flaky", runnerPathKey),
    artifactDir: path.join(
      result.suiteRunArtifactDir,
      "flaky",
      runnerPathKey,
      "repeat-1",
      "session-2",
    ),
    repeatTarget: 1,
    completedRepetitions: 1,
    successfulRepetitions: 1,
  });
  expect(runnerResult.repetitions).toHaveLength(1);
  expect(runnerResult.repetitions?.[0]?.sessions).toHaveLength(2);
  expect(
    runnerResult.repetitions?.[0]?.sessions?.map((session) => session.executionArtifactDir),
  ).toEqual([
    path.join(result.suiteRunArtifactDir, "flaky", runnerPathKey, "repeat-1"),
    path.join(result.suiteRunArtifactDir, "flaky", runnerPathKey, "repeat-1", "session-2"),
  ]);

  const saved = JSON.parse(
    await readFile(path.join(result.suiteRunArtifactDir, "results.json"), "utf8"),
  ) as SuiteRunResult;
  expect(saved.cases[0]?.runnerResults[0]?.repetitions?.[0]?.sessions).toHaveLength(2);
});

test("executeSuite does not retry expected failures", async () => {
  const suiteRunArtifactDir = await createTempDir();
  let sessions = 0;

  const result = await executeSuite(
    "./suite.ts",
    [{ id: "known-gap", prompt: "a", expectedFail: true, assert() {} }],
    {
      cwd: suiteRunArtifactDir,
      suiteRunArtifactDir,
      retryFailed: 2,
      isInteractive: false,
      config: {
        runners: {
          open: { agent: { type: "opencode", model: "openai/gpt-5" } },
        },
      },
      executeRunnerFn: async (case_, runner, _adapter, options) => {
        sessions += 1;
        return createRunnerResult({
          caseId: case_.id,
          runner,
          passed: false,
          durationMs: 10,
          executionArtifactDir: options.artifactDir,
          totalTokens: 100,
          outputTokens: 20,
          observedReads: 1,
        });
      },
    },
  );

  expect(sessions).toBe(1);
  expect(result.cases[0]?.runnerResults[0]).toMatchObject({
    passed: true,
    status: "expected-failed",
    session: 1,
  });
});

test("executeSuite with isolated-by-runner runs serially within a runner and concurrently across runners", async () => {
  const suiteRunArtifactDir = await createTempDir();
  const started: string[] = [];
  const activeByRunner = new Map<string, number>();
  const firstRunBlockers = new Map<string, Deferred<void>>([
    ["open", createDeferred<void>()],
    ["code", createDeferred<void>()],
  ]);
  const secondRunBlockers = new Map<string, Deferred<void>>([
    ["open", createDeferred<void>()],
    ["code", createDeferred<void>()],
  ]);
  let maxGlobalConcurrency = 0;

  const resultPromise = executeSuite(
    "./suite.ts",
    [
      { id: "alpha", prompt: "a", assert() {} },
      { id: "beta", prompt: "b", assert() {} },
    ],
    {
      cwd: suiteRunArtifactDir,
      suiteRunArtifactDir,
      schedule: "isolated-by-runner",
      isInteractive: false,
      config: {
        runners: {
          open: { agent: { type: "opencode", model: "openai/gpt-5" } },
          code: { agent: { type: "codex", model: "gpt-5" } },
        },
      },
      executeRunnerFn: async (case_, runner, _adapter, options) => {
        started.push(`${case_.id}:${runner.id}`);
        activeByRunner.set(runner.id, (activeByRunner.get(runner.id) ?? 0) + 1);
        maxGlobalConcurrency = Math.max(
          maxGlobalConcurrency,
          [...activeByRunner.values()].reduce((sum, value) => sum + value, 0),
        );

        try {
          if (case_.id === "alpha") {
            await firstRunBlockers.get(runner.id)?.promise;
          } else {
            await secondRunBlockers.get(runner.id)?.promise;
          }

          return createRunnerResult({
            caseId: case_.id,
            runner,
            passed: true,
            durationMs: 10,
            executionArtifactDir: options.artifactDir,
            totalTokens: 100,
            outputTokens: 20,
            reasoningTokens: 2,
            observedReads: 1,
          });
        } finally {
          activeByRunner.set(runner.id, (activeByRunner.get(runner.id) ?? 1) - 1);
        }
      },
    },
  );

  await waitFor(() => started.length === 1);
  expect(started).toEqual(["alpha:open"]);

  firstRunBlockers.get("open")?.resolve();
  await waitFor(() => started.includes("alpha:code"));
  expect(started).not.toContain("beta:code");
  expect(started).not.toContain("beta:open");

  firstRunBlockers.get("code")?.resolve();
  await waitFor(() => started.includes("beta:open") && started.includes("beta:code"));
  expect(maxGlobalConcurrency).toBeGreaterThanOrEqual(2);
  secondRunBlockers.get("open")?.resolve();
  secondRunBlockers.get("code")?.resolve();
  const result = await resultPromise;

  expect(started.indexOf("beta:open")).toBeGreaterThan(started.indexOf("alpha:open"));
  expect(started.indexOf("beta:code")).toBeGreaterThan(started.indexOf("alpha:code"));
  expect(result.cases.map((caseResult) => caseResult.caseId)).toEqual(["alpha", "beta"]);
  expect(result.cases[0]?.runnerResults.map((runnerResult) => runnerResult.runner.id)).toEqual([
    "open",
    "code",
  ]);
  expect(result.cases[1]?.runnerResults.map((runnerResult) => runnerResult.runner.id)).toEqual([
    "open",
    "code",
  ]);
});

test("executeSuite with isolated-by-runner caps active runner lanes", async () => {
  const suiteRunArtifactDir = await createTempDir();
  const started: string[] = [];
  const pending = new Map<string, Deferred<void>>();

  const suitePromise = executeSuite(
    "./suite.ts",
    [
      { id: "alpha", prompt: "a", assert() {} },
      { id: "beta", prompt: "b", assert() {} },
    ],
    {
      cwd: suiteRunArtifactDir,
      suiteRunArtifactDir,
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
      executeRunnerFn: async (case_, runner, _adapter, options) => {
        const key = `${case_.id}:${runner.id}`;
        started.push(key);

        const shouldBlock =
          key === "alpha:open" ||
          key === "alpha:code" ||
          key === "beta:open" ||
          key === "beta:code";
        if (shouldBlock) {
          const deferred = createDeferred<void>();
          pending.set(key, deferred);
          await deferred.promise;
        }

        return createRunnerResult({
          caseId: case_.id,
          runner,
          passed: true,
          durationMs: 10,
          executionArtifactDir: options.artifactDir,
          totalTokens: 100,
          outputTokens: 20,
          reasoningTokens: 2,
          observedReads: 1,
        });
      },
    },
  );

  await waitFor(() => started.includes("alpha:open"));
  expect(started).toEqual(["alpha:open"]);
  expect(started).not.toContain("alpha:cursor");

  pending.get("alpha:open")?.resolve();
  await waitFor(() => started.includes("alpha:code"));
  expect(started).not.toContain("alpha:cursor");
  expect(started).not.toContain("beta:open");

  pending.get("alpha:code")?.resolve();
  await waitFor(() => started.includes("alpha:cursor"));

  pending.get("alpha:cursor")?.resolve();
  await waitFor(() => started.includes("beta:open") && started.includes("beta:code"));
  expect(started).not.toContain("beta:cursor");

  pending.get("beta:open")?.resolve();
  await waitFor(() => started.includes("beta:cursor"));

  for (const deferred of pending.values()) {
    deferred.resolve();
  }

  await suitePromise;
});

test("executeSuite reports runner execution errors as failed executions", async () => {
  const suiteRunArtifactDir = await createTempDir();
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

  const cases: Case[] = [{ id: "alpha", prompt: "a", assert() {} }];

  const result = await executeSuite("./suite.ts", cases, {
    cwd: suiteRunArtifactDir,
    suiteRunArtifactDir,
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
  expect(result.cases[0]?.runnerResults[0]?.failureClass).toEqual({
    id: "runner-crash",
    label: "Runner crash",
  });
  expect(result.cases[0]?.runnerResults[0]?.error?.message).toBe("boom");
  expect(calls).toEqual(["suite:start", "runner:start"]);
});

test("classifyExpectedFailure maps raw outcomes to expectation-aware statuses", async () => {
  const suiteRunArtifactDir = await createTempDir();
  const runner = createRunnerInfo("open", { type: "opencode", model: "openai/gpt-5" });
  const normalCase: Case = { id: "normal", prompt: "a", assert() {} };
  const expectedCase: Case = { id: "expected", prompt: "a", expectedFail: true, assert() {} };

  expect(
    classifyExpectedFailure(
      normalCase,
      createRunnerResult({
        caseId: "normal",
        runner,
        passed: true,
        durationMs: 10,
        executionArtifactDir: path.join(suiteRunArtifactDir, "normal", runner.pathKey),
        totalTokens: 100,
        outputTokens: 20,
        observedReads: 1,
      }),
    ),
  ).toMatchObject({ passed: true, status: "passed" });
  expect(
    classifyExpectedFailure(
      normalCase,
      createRunnerResult({
        caseId: "normal",
        runner,
        passed: false,
        durationMs: 10,
        executionArtifactDir: path.join(suiteRunArtifactDir, "normal", runner.pathKey),
        totalTokens: 100,
        outputTokens: 20,
        observedReads: 1,
      }),
    ),
  ).toMatchObject({ passed: false, status: "failed" });
  expect(
    classifyExpectedFailure(
      expectedCase,
      createRunnerResult({
        caseId: "expected",
        runner,
        passed: false,
        durationMs: 10,
        executionArtifactDir: path.join(suiteRunArtifactDir, "expected", runner.pathKey),
        totalTokens: 100,
        outputTokens: 20,
        observedReads: 1,
      }),
    ),
  ).toMatchObject({ passed: true, status: "expected-failed" });
  expect(
    classifyExpectedFailure(
      expectedCase,
      createRunnerResult({
        caseId: "expected",
        runner,
        passed: true,
        durationMs: 10,
        executionArtifactDir: path.join(suiteRunArtifactDir, "expected", runner.pathKey),
        totalTokens: 100,
        outputTokens: 20,
        observedReads: 1,
      }),
    ),
  ).toMatchObject({ passed: false, status: "unexpected-passed" });
  expect(
    classifyExpectedFailure(
      expectedCase,
      createRunnerResult({
        caseId: "expected",
        runner,
        passed: false,
        durationMs: 10,
        executionArtifactDir: path.join(suiteRunArtifactDir, "expected", runner.pathKey),
        totalTokens: 100,
        outputTokens: 20,
        observedReads: 1,
        failureOrigin: "runner",
        failureClass: { id: "runner-crash", label: "Runner crash" },
      }),
    ),
  ).toMatchObject({ passed: false, status: "failed" });
});

test("classifyExpectedFailure applies custom failure classification hooks", async () => {
  const suiteRunArtifactDir = await createTempDir();
  const runner = createRunnerInfo("open", { type: "opencode", model: "openai/gpt-5" });
  const case_: Case = {
    id: "expected",
    prompt: "a",
    classifyFailure(result) {
      return result.error?.message.includes("alias")
        ? { id: "wrong-cli-alias", label: "Wrong CLI alias" }
        : undefined;
    },
    assert() {},
  };

  const result = classifyExpectedFailure(case_, {
    ...createRunnerResult({
      caseId: "expected",
      runner,
      passed: false,
      durationMs: 10,
      executionArtifactDir: path.join(suiteRunArtifactDir, "expected", runner.pathKey),
      totalTokens: 100,
      outputTokens: 20,
      observedReads: 1,
    }),
    error: {
      name: "AssertionError",
      message: "wrong cli alias used",
    },
  });

  expect(result.failureClass).toEqual({ id: "wrong-cli-alias", label: "Wrong CLI alias" });
  expect(result.status).toBe("failed");
});

test("executeSuite aggregates runner summaries from case-centric results", async () => {
  const suiteRunArtifactDir = await createTempDir();
  let suiteResult: SuiteRunResult | undefined;

  const reporter: BenchmarkReporter = {
    onSuiteFinish(event) {
      suiteResult = event.result;
    },
  };

  const cases: Case[] = [
    { id: "alpha", prompt: "a", assert() {} },
    { id: "beta", prompt: "b", assert() {} },
  ];

  await executeSuite("./suite.ts", cases, {
    cwd: suiteRunArtifactDir,
    suiteRunArtifactDir,
    reporter,
    isInteractive: false,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
        code: { agent: { type: "codex", model: "gpt-5" } },
      },
    },
    executeRunnerFn: async (case_, runner, _adapter, options) => {
      if (runner.id === "open") {
        return createRunnerResult({
          caseId: case_.id,
          runner,
          passed: true,
          durationMs: case_.id === "alpha" ? 20 : 40,
          executionArtifactDir: options.artifactDir,
          totalTokens: case_.id === "alpha" ? 200 : 300,
          outputTokens: 20,
          reasoningTokens: 5,
          observedReads: 1,
        });
      }

      return createRunnerResult({
        caseId: case_.id,
        runner,
        passed: case_.id === "beta",
        durationMs: case_.id === "alpha" ? 50 : 70,
        executionArtifactDir: options.artifactDir,
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

test("executeSuite aggregates expected failures without failing the suite", async () => {
  const suiteRunArtifactDir = await createTempDir();

  const result = await executeSuite(
    "./suite.ts",
    [
      { id: "known-gap", prompt: "a", expectedFail: true, assert() {} },
      { id: "stable", prompt: "b", assert() {} },
    ],
    {
      cwd: suiteRunArtifactDir,
      suiteRunArtifactDir,
      isInteractive: false,
      config: {
        runners: {
          open: { agent: { type: "opencode", model: "openai/gpt-5" } },
        },
      },
      executeRunnerFn: async (case_, runner, _adapter, options) =>
        createRunnerResult({
          caseId: case_.id,
          runner,
          passed: case_.id !== "known-gap",
          durationMs: 10,
          executionArtifactDir: options.artifactDir,
          totalTokens: 100,
          outputTokens: 20,
          observedReads: 1,
        }),
    },
  );

  expect(result.cases).toMatchObject([
    {
      caseId: "known-gap",
      passed: true,
      runnerResults: [{ passed: true, status: "expected-failed" }],
    },
    { caseId: "stable", passed: true, runnerResults: [{ passed: true, status: "passed" }] },
  ]);
  expect(result.runners[0]).toMatchObject({ totalCases: 2, passedCases: 2, successRate: 1 });

  const saved = JSON.parse(
    await readFile(path.join(result.suiteRunArtifactDir, "results.json"), "utf8"),
  ) as SuiteRunResult;
  expect(saved.cases[0]?.runnerResults[0]?.status).toBe("expected-failed");
});

test("executeSuite repeats successful executions and aggregates repetition metrics", async () => {
  const suiteRunArtifactDir = await createTempDir();
  let invocation = 0;

  const result = await executeSuite("./suite.ts", [{ id: "stable", prompt: "a", assert() {} }], {
    cwd: suiteRunArtifactDir,
    suiteRunArtifactDir,
    repeat: 3,
    repeatFailure: 1,
    isInteractive: false,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
      },
    },
    executeRunnerFn: async (case_, runner, _adapter, options) => {
      invocation += 1;
      return createRunnerResult({
        caseId: case_.id,
        runner,
        passed: true,
        durationMs: invocation * 10,
        executionArtifactDir: options.artifactDir,
        totalTokens: invocation * 100,
        outputTokens: 20,
        observedReads: 1,
      });
    },
  });

  expect(invocation).toBe(3);
  expect(result.cases[0]?.runnerResults[0]).toMatchObject({
    passed: true,
    status: "passed",
    repeatTarget: 3,
    completedRepetitions: 3,
    successfulRepetitions: 3,
    durationMs: 20,
  });
  expect(result.cases[0]?.runnerResults[0]?.report.usage.totalTokens).toBe(200);
  expect(
    result.cases[0]?.runnerResults[0]?.repetitions?.map((entry) => entry.executionArtifactDir),
  ).toEqual([
    path.join(
      result.suiteRunArtifactDir,
      "stable",
      createRunnerInfo("open", { type: "opencode", model: "openai/gpt-5" }).pathKey,
      "repeat-1",
    ),
    path.join(
      result.suiteRunArtifactDir,
      "stable",
      createRunnerInfo("open", { type: "opencode", model: "openai/gpt-5" }).pathKey,
      "repeat-2",
    ),
    path.join(
      result.suiteRunArtifactDir,
      "stable",
      createRunnerInfo("open", { type: "opencode", model: "openai/gpt-5" }).pathKey,
      "repeat-3",
    ),
  ]);
});

test("executeSuite stops on a failed repetition and keeps averages from successful repetitions", async () => {
  const suiteRunArtifactDir = await createTempDir();
  let invocation = 0;

  const result = await executeSuite("./suite.ts", [{ id: "flaky", prompt: "a", assert() {} }], {
    cwd: suiteRunArtifactDir,
    suiteRunArtifactDir,
    repeat: 4,
    repeatFailure: 1,
    isInteractive: false,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
      },
    },
    executeRunnerFn: async (case_, runner, _adapter, options) => {
      invocation += 1;
      if (invocation <= 2) {
        return createRunnerResult({
          caseId: case_.id,
          runner,
          passed: true,
          durationMs: 10,
          executionArtifactDir: options.artifactDir,
          totalTokens: invocation * 100,
          outputTokens: 20,
          observedReads: 1,
        });
      }

      return createRunnerResult({
        caseId: case_.id,
        runner,
        passed: false,
        durationMs: 40,
        executionArtifactDir: options.artifactDir,
        totalTokens: 500,
        outputTokens: 20,
        observedReads: 1,
      });
    },
  });

  expect(result.cases[0]?.runnerResults[0]).toMatchObject({
    passed: false,
    status: "failed",
    repeatTarget: 4,
    completedRepetitions: 3,
    successfulRepetitions: 2,
    stoppedAtRepetition: 3,
    durationMs: 10,
  });
  expect(result.cases[0]?.runnerResults[0]?.report.usage.totalTokens).toBe(150);
  expect(result.cases[0]?.runnerResults[0]?.error?.message).toContain(
    "expected skill to be loaded before command execution",
  );
});

test("executeSuite repeats asserts with persisted temp state and retries failed repetitions", async () => {
  const suiteRunArtifactDir = await createTempDir();
  const stateDir = await createTempDir();
  const stableCounterPath = path.join(stateDir, "stable-counter.json");
  const flakyCounterPath = path.join(stateDir, "flaky-counter.json");
  const runner = createRunnerInfo("open", { type: "opencode", model: "openai/gpt-5" });

  await writeFile(stableCounterPath, JSON.stringify({ value: 0 }, null, 2), "utf8");
  await writeFile(flakyCounterPath, JSON.stringify({ value: 0 }, null, 2), "utf8");

  const stableSeen: number[] = [];
  const flakySeen: number[] = [];
  const suitePath = path.join(stateDir, "repeat-suite.ts");

  const adapter: RunnerAdapter = {
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
        finalOutput: input.prompt,
      });
    },
    async explain() {
      throw new Error("not used in repeat-state test");
    },
  };

  const cases: Case[] = [
    {
      id: "repeat-counter-stable",
      prompt: "Print the stable repeat counter.",
      async assert() {
        const next = await incrementCounter(stableCounterPath);
        stableSeen.push(next);
        console.log(next);
      },
    },
    {
      id: "repeat-counter-flaky",
      prompt: "Print the flaky repeat counter.",
      async assert() {
        const next = await incrementCounter(flakyCounterPath);
        flakySeen.push(next);
        console.log(next);

        if (next === 3 || next === 4) {
          throw new Error(`intentional failure at counter ${String(next)}`);
        }
      },
    },
  ];

  const result = await executeSuite(suitePath, cases, {
    cwd: suiteRunArtifactDir,
    suiteRunArtifactDir,
    repeat: 4,
    repeatFailure: 2,
    isInteractive: false,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
      },
    },
    executeRunnerFn: (case_, runnerInfo, _unusedAdapter, options) => {
      return executeRunner(case_, runnerInfo, adapter, options);
    },
  });

  const stableResult = result.cases.find(
    (caseResult) => caseResult.caseId === "repeat-counter-stable",
  )?.runnerResults[0];
  const flakyResult = result.cases.find(
    (caseResult) => caseResult.caseId === "repeat-counter-flaky",
  )?.runnerResults[0];

  expect(stableSeen).toEqual([1, 2, 3, 4]);
  expect(flakySeen).toEqual([1, 2, 3, 4, 5, 6]);
  expect(await readCounter(stableCounterPath)).toBe(4);
  expect(await readCounter(flakyCounterPath)).toBe(6);

  expect(stableResult).toMatchObject({
    passed: true,
    status: "passed",
    repeatTarget: 4,
    completedRepetitions: 4,
    successfulRepetitions: 4,
  });
  expect(stableResult?.repetitions?.map((entry) => entry.session)).toEqual([1, 1, 1, 1]);

  expect(flakyResult).toMatchObject({
    passed: true,
    status: "passed",
    repeatTarget: 4,
    completedRepetitions: 4,
    successfulRepetitions: 4,
    session: 1,
  });
  expect(flakyResult?.repetitions).toHaveLength(4);
  expect(flakyResult?.repetitions?.map((entry) => entry.session)).toEqual([1, 1, 3, 1]);
  expect(flakyResult?.repetitions?.[2]?.sessions?.map((entry) => entry.passed)).toEqual([
    false,
    false,
    true,
  ]);
  expect(flakyResult?.repetitions?.[2]?.sessions?.map((entry) => entry.error?.message)).toEqual([
    "intentional failure at counter 3",
    "intentional failure at counter 4",
    undefined,
  ]);
  expect(flakyResult?.repetitions?.[2]?.sessions?.[0]?.executionArtifactDir).toBe(
    path.join(result.suiteRunArtifactDir, "repeat-counter-flaky", runner.pathKey, "repeat-3"),
  );
  expect(flakyResult?.repetitions?.[2]?.sessions?.[1]?.executionArtifactDir).toBe(
    path.join(
      result.suiteRunArtifactDir,
      "repeat-counter-flaky",
      runner.pathKey,
      "repeat-3",
      "session-2",
    ),
  );
  expect(flakyResult?.repetitions?.[2]?.sessions?.[2]?.executionArtifactDir).toBe(
    path.join(
      result.suiteRunArtifactDir,
      "repeat-counter-flaky",
      runner.pathKey,
      "repeat-3",
      "session-3",
    ),
  );
  expect(flakyResult?.artifactDir).toBe(
    path.join(result.suiteRunArtifactDir, "repeat-counter-flaky", runner.pathKey, "repeat-4"),
  );
});

test("executeSuite filters cases by tags with OR semantics and preserves result metadata", async () => {
  const suiteRunArtifactDir = await createTempDir();
  const executed: string[] = [];
  const contexts: Array<{ tagFilter?: string[]; declaredTags: string[] }> = [];
  const cases: Case[] = [
    { id: "alpha", prompt: "a", tags: ["smoke", "fast", "smoke"], assert() {} },
    { id: "beta", prompt: "b", tags: ["regression"], assert() {} },
    { id: "gamma", prompt: "c", assert() {} },
  ];

  const result = await executeSuite("./suite.ts", cases, {
    cwd: suiteRunArtifactDir,
    suiteRunArtifactDir,
    tags: ["fast", "regression"],
    reporter: {
      onSuiteStart(event) {
        contexts.push({
          tagFilter: event.context.tagFilter,
          declaredTags: event.context.declaredTags,
        });
      },
    },
    isInteractive: false,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
      },
    },
    executeRunnerFn: async (case_, runner, _adapter, options) => {
      executed.push(case_.id);
      return createRunnerResult({
        caseId: case_.id,
        runner,
        passed: true,
        durationMs: 10,
        executionArtifactDir: options.artifactDir,
        totalTokens: 100,
        outputTokens: 20,
        observedReads: 1,
      });
    },
  });

  expect(executed).toEqual(["alpha", "beta"]);
  expect(contexts).toEqual([
    { tagFilter: ["fast", "regression"], declaredTags: ["smoke", "fast", "regression"] },
  ]);
  expect(result.declaredTags).toEqual(["smoke", "fast", "regression"]);
  expect(result.selectedTags).toEqual(["fast", "regression"]);
  expect(
    result.cases.map((caseResult) => ({ caseId: caseResult.caseId, tags: caseResult.tags })),
  ).toEqual([
    { caseId: "alpha", tags: ["smoke", "fast"] },
    { caseId: "beta", tags: ["regression"] },
  ]);

  const saved = JSON.parse(
    await readFile(path.join(result.suiteRunArtifactDir, "results.json"), "utf8"),
  ) as SuiteRunResult;
  expect(saved.declaredTags).toEqual(["smoke", "fast", "regression"]);
  expect(saved.selectedTags).toEqual(["fast", "regression"]);
  expect(saved.cases[0]?.tags).toEqual(["smoke", "fast"]);
});

test("executeSuite composes tag filters with case and runner filters", async () => {
  const suiteRunArtifactDir = await createTempDir();
  const executed: string[] = [];
  const cases: Case[] = [
    { id: "alpha", prompt: "a", tags: ["smoke"], assert() {} },
    { id: "beta", prompt: "b", tags: ["smoke"], assert() {} },
  ];

  await executeSuite("./suite.ts", cases, {
    cwd: suiteRunArtifactDir,
    suiteRunArtifactDir,
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
    executeRunnerFn: async (case_, runner, _adapter, options) => {
      executed.push(`${case_.id}:${runner.id}`);
      return createRunnerResult({
        caseId: case_.id,
        runner,
        passed: true,
        durationMs: 10,
        executionArtifactDir: options.artifactDir,
        totalTokens: 100,
        outputTokens: 20,
        observedReads: 1,
      });
    },
  });

  expect(executed).toEqual(["beta:code"]);
});

test("executeSuite reports active tag filters when no cases match", async () => {
  const suiteRunArtifactDir = await createTempDir();
  let errorContext: { tagFilter?: string[]; declaredTags: string[] } | undefined;

  await expect(
    executeSuite("./suite.ts", [{ id: "alpha", prompt: "a", tags: ["smoke"], assert() {} }], {
      cwd: suiteRunArtifactDir,
      suiteRunArtifactDir,
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
    }),
  ).rejects.toThrow("No cases matched the requested filters.");

  expect(errorContext).toEqual({ tagFilter: ["missing"], declaredTags: ["smoke"] });
});

test("executeSuite preserves unrelated snapshots and writes new entries for selected executions", async () => {
  const suiteRunArtifactDir = await createTempDir();
  const snapshotsPath = path.join(suiteRunArtifactDir, "skillgym.snapshots.json");
  await writeFile(
    snapshotsPath,
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
    "utf8",
  );

  await executeSuite("./suite.ts", [{ id: "alpha", prompt: "a", assert() {} }], {
    cwd: suiteRunArtifactDir,
    suiteRunArtifactDir,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
      },
    },
    snapshots: createSnapshotRuntime(snapshotsPath),
    executeRunnerFn: async (case_, runner, _adapter, options) =>
      executeRunner(case_, runner, createSnapshotAdapter(runner, 150), options),
  });

  const saved = JSON.parse(await readFile(snapshotsPath, "utf8")) as {
    entries: Record<string, { value: number }>;
  };

  expect(saved.entries["other-case::other-runner"]?.value).toBe(88);
  expect(saved.entries["alpha::open"]?.value).toBe(150);
});

test("executeSuite refreshes matching snapshots in update mode", async () => {
  const suiteRunArtifactDir = await createTempDir();
  const snapshotsPath = path.join(suiteRunArtifactDir, "skillgym.snapshots.json");
  await writeFile(
    snapshotsPath,
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
    "utf8",
  );

  await executeSuite("./suite.ts", [{ id: "alpha", prompt: "a", assert() {} }], {
    cwd: suiteRunArtifactDir,
    suiteRunArtifactDir,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
      },
    },
    snapshots: {
      ...createSnapshotRuntime(snapshotsPath),
      updateSnapshots: true,
    },
    executeRunnerFn: async (case_, runner, _adapter, options) =>
      executeRunner(case_, runner, createSnapshotAdapter(runner, 222), options),
  });

  const saved = JSON.parse(await readFile(snapshotsPath, "utf8")) as {
    entries: Record<string, { value: number }>;
  };

  expect(saved.entries["alpha::open"]?.value).toBe(222);
});

test("executeSuite snapshots use the average of successful repetitions", async () => {
  const suiteRunArtifactDir = await createTempDir();
  const snapshotsPath = path.join(suiteRunArtifactDir, "skillgym.snapshots.json");
  let invocation = 0;

  await executeSuite("./suite.ts", [{ id: "alpha", prompt: "a", assert() {} }], {
    cwd: suiteRunArtifactDir,
    suiteRunArtifactDir,
    repeat: 2,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
      },
    },
    snapshots: createSnapshotRuntime(snapshotsPath),
    executeRunnerFn: async (case_, runner, _adapter, options) => {
      invocation += 1;
      return executeRunner(
        case_,
        runner,
        createSnapshotAdapter(runner, invocation === 1 ? 100 : 200),
        options,
      );
    },
  });

  const saved = JSON.parse(await readFile(snapshotsPath, "utf8")) as {
    entries: Record<string, { value: number }>;
  };

  expect(saved.entries["alpha::open"]?.value).toBe(150);
});

test("executeSuite raises process max listeners for parallel runs and restores it", async () => {
  const suiteRunArtifactDir = await createTempDir();
  const originalMaxListeners = process.getMaxListeners();
  const observedMaxListeners: number[] = [];
  const cases: Case[] = [
    { id: "alpha", prompt: "a", assert() {} },
    { id: "beta", prompt: "b", assert() {} },
  ];

  try {
    await executeSuite("./suite.ts", cases, {
      cwd: suiteRunArtifactDir,
      outputDir: suiteRunArtifactDir,
      schedule: "parallel",
      maxParallel: originalMaxListeners + 2,
      isInteractive: false,
      config: {
        runners: {
          open: { agent: { type: "opencode", model: "openai/gpt-5" } },
          code: { agent: { type: "codex", model: "gpt-5" } },
        },
      },
      executeRunnerFn: async (case_, runner, _adapter, options) => {
        observedMaxListeners.push(process.getMaxListeners());
        return createRunnerResult({
          caseId: case_.id,
          runner,
          passed: true,
          durationMs: 10,
          executionArtifactDir: options.artifactDir,
          outputTokens: 20,
          observedReads: 0,
        });
      },
    });
  } finally {
    expect(process.getMaxListeners()).toBe(originalMaxListeners);
  }

  expect(observedMaxListeners).not.toHaveLength(0);
  expect(Math.min(...observedMaxListeners)).toBe((originalMaxListeners + 2) * 2);
});

function createRunnerResultForKey(
  caseId: string,
  runnerId: string,
  suiteRunArtifactDir: string,
  passed: boolean,
): RunnerResult {
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
    executionArtifactDir: path.join(suiteRunArtifactDir, caseId, runner.pathKey),
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
  executionArtifactDir: string;
  totalTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  observedReads: number;
  failureOrigin?: RunnerResult["failureOrigin"];
  failureClass?: RunnerResult["failureClass"];
}): RunnerResult {
  const inputTokens =
    options.totalTokens === undefined
      ? undefined
      : options.totalTokens - options.outputTokens - (options.reasoningTokens ?? 0);

  return {
    runner: options.runner,
    passed: options.passed,
    status: options.passed ? "passed" : "failed",
    durationMs: options.durationMs,
    executionArtifactDir: options.executionArtifactDir,
    artifactDir: options.executionArtifactDir,
    error: options.passed
      ? undefined
      : {
          name: "AssertionError",
          message: "expected skill to be loaded before command execution",
        },
    failureOrigin: options.passed ? undefined : (options.failureOrigin ?? "assertion"),
    failureClass: options.passed
      ? undefined
      : (options.failureClass ?? { id: "assertion", label: "Assertion failure" }),
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

async function incrementCounter(filePath: string): Promise<number> {
  const current = await readCounter(filePath);
  const next = current + 1;
  await writeFile(filePath, JSON.stringify({ value: next }, null, 2), "utf8");
  return next;
}

async function readCounter(filePath: string): Promise<number> {
  const contents = JSON.parse(await readFile(filePath, "utf8")) as { value?: unknown };
  if (typeof contents.value !== "number") {
    throw new Error(`Invalid counter file: ${filePath}`);
  }

  return contents.value;
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
    async explain() {
      throw new Error("not used in snapshot adapter tests");
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

async function waitFor(predicate: () => boolean, sessions = 50): Promise<void> {
  for (let index = 0; index < sessions; index += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for condition");
}
