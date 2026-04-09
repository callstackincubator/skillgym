import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { CodexAdapter } from "../../src/adapters/codex.js";
import type { RawRunArtifacts, RunHandle, RunInput } from "../../src/domain/adapter.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })));
});

test("CodexAdapter normalize uses cumulative total_token_usage metrics", async () => {
  const adapter = new CodexAdapter();
  const input = createRunInput();

  const report = await adapter.normalize(input, {
    ...createArtifacts(),
    stdout: "fallback stdout",
    rawSession: [
      {
        timestamp: "2026-04-03T08:50:46.816Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 23_996,
              cached_input_tokens: 2_432,
              output_tokens: 270,
              reasoning_output_tokens: 68,
              total_tokens: 24_266,
            },
            last_token_usage: {
              input_tokens: 23_996,
              cached_input_tokens: 2_432,
              output_tokens: 270,
              reasoning_output_tokens: 68,
              total_tokens: 24_266,
            },
          },
        },
      },
      {
        timestamp: "2026-04-03T08:51:00.111Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 75_611,
              cached_input_tokens: 52_224,
              output_tokens: 832,
              reasoning_output_tokens: 96,
              total_tokens: 76_443,
            },
            last_token_usage: {
              input_tokens: 26_232,
              cached_input_tokens: 25_600,
              output_tokens: 200,
              reasoning_output_tokens: 9,
              total_tokens: 26_432,
            },
          },
        },
      },
      {
        timestamp: "2026-04-03T08:51:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          text: "final answer",
          phase: "final_answer",
        },
      },
    ],
  });

  expect(report.usage.totalTokens).toBe(76_443);
  expect(report.usage.inputTokens).toBe(75_611);
  expect(report.usage.outputTokens).toBe(832);
  expect(report.usage.reasoningTokens).toBe(96);
  expect(report.usage.completionTokens).toBe(928);
  expect(report.finalOutput).toBe("final answer");
});

test("CodexAdapter normalize extracts separate file reads from chained shell commands", async () => {
  const adapter = new CodexAdapter();
  const input = createRunInput();

  const report = await adapter.normalize(input, {
    ...createArtifacts(),
    rawSession: [
      {
        timestamp: "2026-04-03T10:00:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          output: [
            "Command: /bin/zsh -lc \"sed -n '1,200p' README.md && echo '---' && sed -n '1,200p' bootstrap-output.txt\"",
            "Output: ok",
          ].join("\n"),
        },
      },
    ],
  });

  expect(report.files.observedReads).toEqual([
    "/tmp/workspace/README.md",
    "/tmp/workspace/bootstrap-output.txt",
  ]);
  expect(report.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "fileRead", path: "/tmp/workspace/README.md" }),
    expect.objectContaining({ type: "fileRead", path: "/tmp/workspace/bootstrap-output.txt" }),
  ]));
});

test("CodexAdapter normalize resolves reads against function call workdir", async () => {
  const adapter = new CodexAdapter();
  const input = createRunInput();

  const report = await adapter.normalize(input, {
    ...createArtifacts(),
    rawSession: [
      {
        timestamp: "2026-04-03T10:00:00.500Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_1",
          arguments: JSON.stringify({
            cmd: "sed -n '1,200p' README.md",
            workdir: "/tmp/isolated-workspace",
          }),
        },
      },
      {
        timestamp: "2026-04-03T10:00:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call_1",
          output: "Command: /bin/zsh -lc \"sed -n '1,200p' README.md\"\nOutput: ok",
        },
      },
    ],
  });

  expect(report.files.observedReads).toEqual(["/tmp/isolated-workspace/README.md"]);
  expect(report.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "fileRead", path: "/tmp/isolated-workspace/README.md" }),
  ]));
});

test("CodexAdapter normalize falls back to turn_context cwd when workdir is missing", async () => {
  const adapter = new CodexAdapter();
  const input = createRunInput();

  const report = await adapter.normalize(input, {
    ...createArtifacts(),
    rawSession: [
      {
        timestamp: "2026-04-03T10:00:00.250Z",
        type: "turn_context",
        payload: {
          cwd: "/tmp/turn-workspace",
        },
      },
      {
        timestamp: "2026-04-03T10:00:00.500Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_1",
          arguments: JSON.stringify({
            cmd: "sed -n '1,200p' README.md",
          }),
        },
      },
      {
        timestamp: "2026-04-03T10:00:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call_1",
          output: "Command: /bin/zsh -lc \"sed -n '1,200p' README.md\"\nOutput: ok",
        },
      },
    ],
  });

  expect(report.files.observedReads).toEqual(["/tmp/turn-workspace/README.md"]);
  expect(report.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "fileRead", path: "/tmp/turn-workspace/README.md" }),
  ]));
});

test("CodexAdapter collect reads isolated session from artifacts codex-home", async () => {
  const adapter = new CodexAdapter();
  const artifactsDir = await createTempDir();
  const input = createRunInput({ artifactsDir });
  const handle = await writeHandleLogs(artifactsDir, {
    startedAt: "2026-04-03T10:00:00.000Z",
    stdout: '{"type":"thread.started","thread_id":"stdout-only"}\n',
  });
  const sessionPath = path.join(
    artifactsDir,
    "codex-home",
    "sessions",
    "2026",
    "04",
    "03",
    "rollout-2026-04-03T10-00-01-thread-a.jsonl",
  );
  const sessionText = '{"timestamp":"2026-04-03T10:00:01.000Z","type":"response_item","payload":{"type":"message","role":"assistant","text":"from isolated session"}}\n';

  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, sessionText, "utf8");
  await utimes(sessionPath, new Date("2026-04-03T10:00:01.000Z"), new Date("2026-04-03T10:00:01.000Z"));

  const artifacts = await adapter.collect(handle, input);

  expect(artifacts.sessionPath).toBe(sessionPath);
  expect(artifacts.exportPath).toBe(path.join(artifactsDir, "session.jsonl"));
  expect(await readFile(artifacts.exportPath!, "utf8")).toBe(sessionText);
  expect(artifacts.rawSession).toEqual([
    {
      timestamp: "2026-04-03T10:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        text: "from isolated session",
      },
    },
  ]);
});

test("CodexAdapter collect keeps runs isolated by artifactsDir", async () => {
  const adapter = new CodexAdapter();
  const firstArtifactsDir = await createTempDir();
  const secondArtifactsDir = await createTempDir();
  const firstInput = createRunInput({ artifactsDir: firstArtifactsDir });
  const secondInput = createRunInput({ artifactsDir: secondArtifactsDir });
  const firstHandle = await writeHandleLogs(firstArtifactsDir, { startedAt: "2026-04-03T10:00:00.000Z" });
  const secondHandle = await writeHandleLogs(secondArtifactsDir, { startedAt: "2026-04-03T10:00:00.000Z" });
  const firstSessionPath = await writeSessionFile(firstArtifactsDir, "first-thread", "first session");
  const secondSessionPath = await writeSessionFile(secondArtifactsDir, "second-thread", "second session");

  const [firstArtifacts, secondArtifacts] = await Promise.all([
    adapter.collect(firstHandle, firstInput),
    adapter.collect(secondHandle, secondInput),
  ]);

  expect(firstArtifacts.sessionPath).toBe(firstSessionPath);
  expect(secondArtifacts.sessionPath).toBe(secondSessionPath);
  expect(await readFile(firstArtifacts.exportPath!, "utf8")).toContain("first session");
  expect(await readFile(secondArtifacts.exportPath!, "utf8")).toContain("second session");
});

test("CodexAdapter run seeds isolated CODEX_HOME from user codex state", async () => {
  const tempDir = await createTempDir();
  const previousHome = process.env.HOME;
  const fakeHome = path.join(tempDir, "home");
  const sourceCodexHome = path.join(fakeHome, ".codex");
  const artifactsDir = path.join(tempDir, "artifacts");
  process.env.HOME = fakeHome;

  await mkdir(sourceCodexHome, { recursive: true });
  await writeFile(path.join(sourceCodexHome, "config.toml"), "model = 'gpt-5'\n", "utf8");
  await writeFile(path.join(sourceCodexHome, "AGENTS.md"), "agent notes\n", "utf8");
  await writeFile(path.join(sourceCodexHome, ".codex-global-state.json"), "{}\n", "utf8");

  try {
    const adapter = new RecordingCodexAdapter({ type: "codex", model: "gpt-5" });
    await adapter.run(createRunInput({ artifactsDir }));

    expect(await readFile(path.join(artifactsDir, "codex-home", "config.toml"), "utf8")).toContain("model");
    expect(await readFile(path.join(artifactsDir, "codex-home", "AGENTS.md"), "utf8")).toContain("agent notes");
    expect(await readFile(path.join(artifactsDir, "codex-home", ".codex-global-state.json"), "utf8")).toContain("{}");
    expect((await stat(path.join(artifactsDir, "codex-home", "sqlite"))).isDirectory()).toBe(true);
  } finally {
    process.env.HOME = previousHome;
  }
});

function createRunInput(overrides: Partial<RunInput> = {}): RunInput {
  return {
    runner: {
        id: "codex-main",
        pathKey: "codex-main",
        agent: {
          type: "codex",
          model: "gpt-5",
        },
      },
    prompt: "solve it",
    cwd: "/tmp/workspace",
    timeoutMs: 5_000,
    artifactsDir: "/tmp/artifacts",
    ...overrides,
  };
}

function createArtifacts(): RawRunArtifacts {
  return {
    stdout: "",
    stderr: "",
    stdoutPath: "/tmp/stdout.log",
    stderrPath: "/tmp/stderr.log",
    startedAt: "2026-04-03T10:00:00.000Z",
    endedAt: "2026-04-03T10:00:01.000Z",
    durationMs: 1_000,
  };
}

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-codex-"));
  tempDirs.push(tempDir);
  return tempDir;
}

async function writeHandleLogs(
  artifactsDir: string,
  options: {
    startedAt: string;
    stdout?: string;
    stderr?: string;
  },
): Promise<RunHandle> {
  const stdoutPath = path.join(artifactsDir, "stdout.log");
  const stderrPath = path.join(artifactsDir, "stderr.log");
  await writeFile(stdoutPath, options.stdout ?? "", "utf8");
  await writeFile(stderrPath, options.stderr ?? "", "utf8");

  return {
    startedAt: options.startedAt,
    endedAt: "2026-04-03T10:00:02.000Z",
    durationMs: 2_000,
    stdoutPath,
    stderrPath,
  };
}

async function writeSessionFile(artifactsDir: string, threadId: string, text: string): Promise<string> {
  const sessionPath = path.join(
    artifactsDir,
    "codex-home",
    "sessions",
    "2026",
    "04",
    "03",
    `rollout-2026-04-03T10-00-01-${threadId}.jsonl`,
  );
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    `{"timestamp":"2026-04-03T10:00:01.000Z","type":"response_item","payload":{"type":"message","role":"assistant","text":"${text}"}}\n`,
    "utf8",
  );
  await utimes(sessionPath, new Date("2026-04-03T10:00:01.000Z"), new Date("2026-04-03T10:00:01.000Z"));
  return sessionPath;
}

class RecordingCodexAdapter extends CodexAdapter {
  protected override async runCommand(
    _command: string,
    _args: string[],
    input: RunInput,
    _options?: { env?: Record<string, string> },
  ): Promise<RunHandle & { stdout: string; stderr: string }> {
    return {
      startedAt: "2026-04-03T10:00:00.000Z",
      endedAt: "2026-04-03T10:00:01.000Z",
      durationMs: 1_000,
      stdoutPath: path.join(input.artifactsDir, "stdout.log"),
      stderrPath: path.join(input.artifactsDir, "stderr.log"),
      stdout: "",
      stderr: "",
    };
  }
}
