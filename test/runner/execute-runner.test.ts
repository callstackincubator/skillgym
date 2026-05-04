import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AssertionError } from "node:assert";
import { afterEach, expect, test } from "vitest";
import { assert as skillgymAssert } from "../../src/assertions/index.js";
import type {
  RawRunArtifacts,
  RunHandle,
  RunInput,
  RunnerAdapter,
} from "../../src/domain/adapter.js";
import type { SnapshotRuntimeOptions } from "../../src/snapshots/store.js";
import { executeRunner } from "../../src/runner/execute-runner.js";
import { createRunnerInfo } from "../../src/runner/runner-info.js";
import { MaxStepsExceededError } from "../../src/limits/max-steps.js";
import { SnapshotStore } from "../../src/snapshots/store.js";
import { createSessionReport } from "../helpers/session-report.js";
import { CommandTimeoutError } from "../../src/utils/process.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })),
  );
});

test("executeRunner forwards showRunnerOutput to adapter runs", async () => {
  const outputDir = await createTempDir();
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const seenInputs: RunInput[] = [];
  const adapter: RunnerAdapter = {
    async run(input: RunInput): Promise<RunHandle> {
      seenInputs.push(input);
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
      });
    },
  };

  const result = await executeRunner(
    { id: "alpha", prompt: "prompt", assert() {} },
    runner,
    adapter,
    {
      cwd: outputDir,
      artifactDir: path.join(outputDir, "alpha", runner.pathKey),
      timeoutMs: 5_000,
      showRunnerOutput: true,
    },
  );

  expect(result.passed).toBe(true);
  expect(seenInputs).toHaveLength(1);
  expect(seenInputs[0]?.showRunnerOutput).toBe(true);
  expect(seenInputs[0]?.runner).toEqual(runner);
});

test("executeRunner marks run as failed when adapter export collection fails", async () => {
  const outputDir = await createTempDir();
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
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
    async collect(): Promise<RawRunArtifacts> {
      throw new Error("OpenCode export returned invalid JSON: Unterminated string");
    },
    async normalize() {
      throw new Error("should not normalize after collect failure");
    },
  };

  const result = await executeRunner(
    { id: "alpha", prompt: "prompt", assert() {} },
    runner,
    adapter,
    {
      cwd: outputDir,
      artifactDir: path.join(outputDir, "alpha", runner.pathKey),
      timeoutMs: 5_000,
    },
  );

  expect(result.passed).toBe(false);
  expect(result.failureType).toBe("runner-crash");
  expect(result.failureOrigin).toBe("collection");
  expect(result.failureLogPath).toBeUndefined();
  expect(result.error).toMatchObject({
    name: "Error",
    message: "OpenCode export returned invalid JSON: Unterminated string",
  });

  const errorJson = await readFile(path.join(result.artifactDir, "error.json"), "utf8");
  expect(errorJson).toContain("OpenCode export returned invalid JSON: Unterminated string");
});

test("executeRunner marks AssertionError failures separately from runner crashes", async () => {
  const outputDir = await createTempDir();
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const adapter = createSuccessfulAdapter(runner, { totalTokens: 120 });

  const result = await executeRunner(
    {
      id: "alpha",
      prompt: "prompt",
      assert() {
        throw new AssertionError({
          message: "expected a skill read",
        });
      },
    },
    runner,
    adapter,
    {
      cwd: outputDir,
      artifactDir: path.join(outputDir, "alpha", runner.pathKey),
      timeoutMs: 5_000,
    },
  );

  expect(result.passed).toBe(false);
  expect(result.failureType).toBe("assertion");
  expect(result.failureOrigin).toBe("assertion");
  expect(result.error?.message).toBe("expected a skill read");
  expect(result.report.usage.totalTokens).toBe(120);
});

test("executeRunner treats non-AssertionError exceptions from assert as run failures", async () => {
  const outputDir = await createTempDir();
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const adapter = createSuccessfulAdapter(runner, { totalTokens: 120 });

  const result = await executeRunner(
    {
      id: "alpha",
      prompt: "prompt",
      assert() {
        throw new Error("assert hook crashed intentionally");
      },
    },
    runner,
    adapter,
    {
      cwd: outputDir,
      artifactDir: path.join(outputDir, "alpha", runner.pathKey),
      timeoutMs: 5_000,
    },
  );

  expect(result.passed).toBe(false);
  expect(result.failureType).toBe("runner-crash");
  expect(result.failureOrigin).toBe("assert-hook");
  expect(result.error?.message).toBe("assert hook crashed intentionally");
  expect(result.report.usage.totalTokens).toBe(120);
});

test("executeRunner flushes collected soft assertion failures after assert hook completes", async () => {
  const outputDir = await createTempDir();
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const adapter = createSuccessfulAdapter(runner, { totalTokens: 120 });

  const result = await executeRunner(
    {
      id: "alpha",
      prompt: "prompt",
      assert(report) {
        skillgymAssert.soft.output.notEmpty(report, { message: "expected output" });
        skillgymAssert.soft.commands.includes(report, "pnpm test", { message: "expected command" });
      },
    },
    runner,
    adapter,
    {
      cwd: outputDir,
      artifactDir: path.join(outputDir, "alpha", runner.pathKey),
      timeoutMs: 5_000,
    },
  );

  expect(result.passed).toBe(false);
  expect(result.failureType).toBe("assertion");
  expect(result.failureOrigin).toBe("assertion");
  expect(result.error?.message).toContain(
    "2 assertion failures collected during test case execution",
  );
  expect(result.error?.message).toContain("expected output");
  expect(result.error?.message).toContain("expected command");
});

test("executeRunner merges soft failures with a later hard AssertionError", async () => {
  const outputDir = await createTempDir();
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const adapter = createSuccessfulAdapter(runner, { totalTokens: 120 });

  const result = await executeRunner(
    {
      id: "alpha",
      prompt: "prompt",
      assert(report) {
        skillgymAssert.soft.output.notEmpty(report, { message: "soft failure" });
        throw new AssertionError({ message: "hard failure" });
      },
    },
    runner,
    adapter,
    {
      cwd: outputDir,
      artifactDir: path.join(outputDir, "alpha", runner.pathKey),
      timeoutMs: 5_000,
    },
  );

  expect(result.passed).toBe(false);
  expect(result.failureType).toBe("assertion");
  expect(result.error?.message).toContain(
    "2 assertion failures collected during test case execution",
  );
  expect(result.error?.message).toContain("soft failure");
  expect(result.error?.message).toContain("hard failure");
});

test("executeRunner clears soft assertion state between runs", async () => {
  const outputDir = await createTempDir();
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const adapter = createSuccessfulAdapter(runner, { totalTokens: 120 });

  const failed = await executeRunner(
    {
      id: "alpha",
      prompt: "prompt",
      assert(report) {
        skillgymAssert.soft.output.notEmpty(report, { message: "soft failure" });
      },
    },
    runner,
    adapter,
    {
      cwd: outputDir,
      artifactDir: path.join(outputDir, "alpha", runner.pathKey),
      timeoutMs: 5_000,
    },
  );

  const passed = await executeRunner(
    {
      id: "beta",
      prompt: "prompt",
      assert() {},
    },
    runner,
    adapter,
    {
      cwd: outputDir,
      artifactDir: path.join(outputDir, "beta", runner.pathKey),
      timeoutMs: 5_000,
    },
  );

  expect(failed.passed).toBe(false);
  expect(passed.passed).toBe(true);
});

test("executeRunner marks timeout failures separately from runner crashes", async () => {
  const outputDir = await createTempDir();
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const adapter: RunnerAdapter = {
    async run(): Promise<RunHandle> {
      throw new CommandTimeoutError("opencode", ["run", "prompt"], 5_000);
    },
    async collect() {
      throw new Error("should not collect after timeout");
    },
    async normalize() {
      throw new Error("should not normalize after timeout");
    },
  };

  const result = await executeRunner(
    { id: "alpha", prompt: "prompt", assert() {} },
    runner,
    adapter,
    {
      cwd: outputDir,
      artifactDir: path.join(outputDir, "alpha", runner.pathKey),
      timeoutMs: 5_000,
    },
  );

  expect(result.passed).toBe(false);
  expect(result.failureType).toBe("timeout");
  expect(result.failureOrigin).toBe("runner");
  expect(result.failureLogPath).toBe(path.join(result.artifactDir, "stderr.log"));
  expect(result.error?.message).toBe("Command timed out after 5000ms: opencode run prompt");
});

test("executeRunner marks max-steps failures separately from other runner crashes", async () => {
  const outputDir = await createTempDir();
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const adapter: RunnerAdapter = {
    async run(): Promise<RunHandle> {
      throw new MaxStepsExceededError({
        observedSteps: 2,
        maxSteps: 1,
        runnerId: runner.id,
        agentType: runner.agent.type,
      });
    },
    async collect() {
      throw new Error("should not collect after max-steps");
    },
    async normalize() {
      throw new Error("should not normalize after max-steps");
    },
  };

  const result = await executeRunner(
    { id: "alpha", prompt: "prompt", assert() {} },
    runner,
    adapter,
    {
      cwd: outputDir,
      artifactDir: path.join(outputDir, "alpha", runner.pathKey),
      timeoutMs: 5_000,
      maxSteps: 1,
    },
  );

  expect(result.passed).toBe(false);
  expect(result.failureType).toBe("runner-crash");
  expect(result.failureOrigin).toBe("max-steps");
  expect(result.failureLogPath).toBe(path.join(result.artifactDir, "stderr.log"));
  expect(result.error?.message).toContain("Exceeded maxSteps: observed 2 steps with limit 1");
});

test("executeRunner creates a missing snapshot baseline and passes", async () => {
  const outputDir = await createTempDir();
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const snapshotsPath = path.join(outputDir, "snapshots.json");
  const runtime = createSnapshotRuntime(snapshotsPath);
  const store = (await SnapshotStore.load(runtime))!;
  const adapter = createSuccessfulAdapter(runner, { totalTokens: 120 });

  const result = await executeRunner(
    { id: "alpha", prompt: "prompt", assert() {} },
    runner,
    adapter,
    {
      cwd: outputDir,
      artifactDir: path.join(outputDir, "alpha", runner.pathKey),
      timeoutMs: 5_000,
      snapshots: { runtime, store },
    },
  );

  await store.save();

  expect(result.passed).toBe(true);
  const saved = await readFile(snapshotsPath, "utf8");
  expect(saved).toContain('"alpha::open-main"');
  expect(saved).toContain('"value": 120');
});

test("executeRunner fails when snapshot absolute tolerance is exceeded", async () => {
  const outputDir = await createTempDir();
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const snapshotsPath = path.join(outputDir, "snapshots.json");
  const runtime = createSnapshotRuntime(snapshotsPath, { absolute: 10 });
  const store = (await SnapshotStore.load(runtime))!;
  store.check({ caseId: "alpha", runner, actual: 100 }, { ...runtime, updateSnapshots: true });
  await store.save();

  const reloadedStore = (await SnapshotStore.load(runtime))!;
  const adapter = createSuccessfulAdapter(runner, { totalTokens: 120 });
  const result = await executeRunner(
    { id: "alpha", prompt: "prompt", assert() {} },
    runner,
    adapter,
    {
      cwd: outputDir,
      artifactDir: path.join(outputDir, "alpha", runner.pathKey),
      timeoutMs: 5_000,
      snapshots: { runtime, store: reloadedStore },
    },
  );

  expect(result.passed).toBe(false);
  expect(result.failureType).toBe("runner-crash");
  expect(result.failureOrigin).toBe("snapshot");
  expect(result.error?.message).toContain("Snapshot mismatch for totalTokens");
  expect(result.error?.message).toContain("alpha / open-main");
});

test("executeRunner fails when snapshot metric is unavailable", async () => {
  const outputDir = await createTempDir();
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const snapshotsPath = path.join(outputDir, "snapshots.json");
  const runtime = createSnapshotRuntime(snapshotsPath);
  const store = (await SnapshotStore.load(runtime))!;
  const adapter = createSuccessfulAdapter(runner, { totalTokens: undefined });

  const result = await executeRunner(
    { id: "alpha", prompt: "prompt", assert() {} },
    runner,
    adapter,
    {
      cwd: outputDir,
      artifactDir: path.join(outputDir, "alpha", runner.pathKey),
      timeoutMs: 5_000,
      snapshots: { runtime, store },
    },
  );

  expect(result.passed).toBe(false);
  expect(result.failureType).toBe("runner-crash");
  expect(result.failureOrigin).toBe("snapshot");
  expect(result.error?.message).toContain(
    "Snapshot check requires provider token metric totalTokens",
  );
});

function createSuccessfulAdapter(
  runner: ReturnType<typeof createRunnerInfo>,
  usage: { totalTokens?: number },
): RunnerAdapter {
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
          cacheTokens: 30,
          totalTokens: usage.totalTokens,
          inputTokens: usage.totalTokens === undefined ? undefined : usage.totalTokens + 30,
          outputTokens: 10,
          reasoningTokens: 2,
          inputChars: 0,
          outputChars: 0,
          reasoningChars: 0,
          source: {
            input: usage.totalTokens === undefined ? "chars" : "provider",
            output: "provider",
            reasoning: "provider",
          },
        },
      });
    },
  };
}

function createSnapshotRuntime(
  filePath: string,
  tolerance: { absolute?: number; percent?: number } = { absolute: 10 },
): SnapshotRuntimeOptions {
  return {
    enabled: true,
    updateSnapshots: false,
    path: filePath,
    config: {
      metric: "totalTokens",
      tolerance,
    },
  };
}

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-runner-"));
  tempDirs.push(tempDir);
  return tempDir;
}
