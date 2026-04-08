import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import type { RawRunArtifacts, RunHandle, RunInput, RunnerAdapter } from "../../src/domain/adapter.ts";
import type { SnapshotRuntimeOptions } from "../../src/snapshots/store.ts";
import { executeRunner } from "../../src/runner/execute-runner.ts";
import { createRunnerInfo } from "../../src/runner/runner-info.ts";
import { SnapshotStore } from "../../src/snapshots/store.ts";
import { createSessionReport } from "../helpers/session-report.ts";
import { CommandTimeoutError } from "../../src/utils/process.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })));
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
  expect(result.error).toMatchObject({
    name: "Error",
    message: "OpenCode export returned invalid JSON: Unterminated string",
  });

  const errorJson = await readFile(path.join(result.artifactDir, "error.json"), "utf8");
  expect(errorJson).toContain("OpenCode export returned invalid JSON: Unterminated string");
});

test("executeRunner marks assertion failures separately from runner crashes", async () => {
  const outputDir = await createTempDir();
  const runner = createRunnerInfo("open-main", { type: "opencode", model: "openai/gpt-5" });
  const adapter = createSuccessfulAdapter(runner, { totalTokens: 120 });

  const result = await executeRunner(
    {
      id: "alpha",
      prompt: "prompt",
      assert() {
        throw new Error("expected a skill read");
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
  expect(result.error?.message).toBe("expected a skill read");
  expect(result.report.usage.totalTokens).toBe(120);
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
  expect(result.error?.message).toBe("Command timed out after 5000ms: opencode run prompt");
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
  expect(result.error?.message).toContain("Snapshot check requires provider token metric totalTokens");
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
          totalTokens: usage.totalTokens,
          inputTokens: usage.totalTokens,
          outputTokens: 10,
          reasoningTokens: 2,
          completionTokens: 12,
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
