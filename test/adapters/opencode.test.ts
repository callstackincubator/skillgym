import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import type { RawRunArtifacts, RunInput } from "../../src/domain/adapter.ts";
import { OpenCodeAdapter } from "../../src/adapters/opencode.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })));
});

test("OpenCodeAdapter collect parses export payload wrapped in extra text", async () => {
  const tempDir = await createTempDir();
  const adapter = new ExportingOpenCodeAdapter({
    exportStdout: JSON.stringify({
      info: { id: "ses_123" },
      messages: [
        {
          info: {
            role: "assistant",
            tokens: {
              input: 111,
              output: 22,
              reasoning: 3,
            },
          },
          parts: [
            {
              type: "text",
              text: "final answer",
            },
          ],
        },
      ],
    }),
  });

  const input = {
    ...createRunInput(),
    cwd: tempDir,
    artifactsDir: path.join(tempDir, "artifacts"),
  } satisfies RunInput;

  const stdoutPath = path.join(tempDir, "stdout.log");
  const stderrPath = path.join(tempDir, "stderr.log");
  await writeFile(stdoutPath, 'session ready: ses_123\n', "utf8");
  await writeFile(stderrPath, "", "utf8");

  const artifacts = await adapter.collect(
    {
      ...createArtifacts(),
      stdoutPath,
      stderrPath,
    },
    input,
  );

  expect(artifacts.sessionId).toBe("ses_123");
  expect(artifacts.rawSession).toMatchObject({
    info: { id: "ses_123" },
  });

  const exported = await readFile(artifacts.exportPath!, "utf8");
  expect(exported).toContain('"id": "ses_123"');
  expect(adapter.exportEnv).toMatchObject({
    XDG_DATA_HOME: path.join(input.artifactsDir, "opencode-xdg", "data"),
    XDG_CONFIG_HOME: path.join(input.artifactsDir, "opencode-xdg", "config"),
    XDG_STATE_HOME: path.join(input.artifactsDir, "opencode-xdg", "state"),
    XDG_CACHE_HOME: path.join(input.artifactsDir, "opencode-xdg", "cache"),
  });

  const report = await adapter.normalize(input, artifacts);

  expect(report.sessionId).toBe("ses_123");
  expect(report.usage.totalTokens).toBeUndefined();
  expect(report.usage.inputTokens).toBe(111);
  expect(report.usage.outputTokens).toBe(22);
  expect(report.usage.reasoningTokens).toBe(3);
  expect(report.usage.completionTokens).toBe(25);
  expect(report.usage.source).toEqual({
    input: "provider",
    output: "provider",
    reasoning: "provider",
  });
});

test("OpenCodeAdapter collect fails when export output is invalid JSON", async () => {
  const tempDir = await createTempDir();
  const adapter = new ExportingOpenCodeAdapter({
    exportStdout: '{"info": {"id": "ses_123"}, "messages": [',
  });

  const input = {
    ...createRunInput(),
    cwd: tempDir,
    artifactsDir: path.join(tempDir, "artifacts"),
  } satisfies RunInput;

  const stdoutPath = path.join(tempDir, "stdout.log");
  const stderrPath = path.join(tempDir, "stderr.log");
  await writeFile(stdoutPath, 'session ready: ses_123\n', "utf8");
  await writeFile(stderrPath, "", "utf8");

  await expect(
    adapter.collect(
      {
        ...createArtifacts(),
        stdoutPath,
        stderrPath,
      },
      input,
    ),
  ).rejects.toThrow("OpenCode export returned invalid JSON");
});

test("OpenCodeAdapter collect fails when run output contains an explicit error event", async () => {
  const tempDir = await createTempDir();
  const adapter = new OpenCodeAdapter();

  const input = {
    ...createRunInput(),
    cwd: tempDir,
    artifactsDir: path.join(tempDir, "artifacts"),
  } satisfies RunInput;

  const stdoutPath = path.join(tempDir, "stdout.log");
  const stderrPath = path.join(tempDir, "stderr.log");
  await writeFile(stdoutPath, '{"type":"error","error":{"message":"The requested model is not supported."}}\n', "utf8");
  await writeFile(stderrPath, "", "utf8");

  await expect(
    adapter.collect(
      {
        ...createArtifacts(),
        stdoutPath,
        stderrPath,
      },
      input,
    ),
  ).rejects.toThrow("OpenCode run failed: The requested model is not supported.");
});

test("OpenCodeAdapter normalize sums message tokens across the exported conversation", async () => {
  const adapter = new OpenCodeAdapter();
  const input = createRunInput();

  const report = await adapter.normalize(input, {
    ...createArtifacts(),
    rawSession: {
      info: { id: "ses_123" },
      messages: [
        {
          info: {
            role: "assistant",
            tokens: {
              total: 9_680,
              input: 111,
              output: 22,
              reasoning: 3,
            },
          },
          parts: [
            {
              type: "tool",
              tool: "read",
              state: {
                input: { filePath: "/tmp/find-skills/SKILL.md" },
              },
              tokens: {
                input: 7,
                output: 2,
              },
            },
          ],
        },
        {
          info: {
            role: "assistant",
            tokens: {
              total: 16_604,
              input: 13,
              output: 5,
              reasoning: 1,
            },
          },
          parts: [
            {
              type: "text",
              text: "final answer",
            },
          ],
        },
      ],
    },
  });

  expect(report.usage.totalTokens).toBe(16_604);
  expect(report.usage.inputTokens).toBe(124);
  expect(report.usage.outputTokens).toBe(27);
  expect(report.usage.reasoningTokens).toBe(4);
  expect(report.usage.completionTokens).toBe(31);
  expect(report.files.observedReads).toEqual(["/tmp/find-skills/SKILL.md"]);
  expect(report.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "fileRead", path: "/tmp/find-skills/SKILL.md" }),
  ]));
});

test("OpenCodeAdapter normalize resolves relative read paths against message cwd", async () => {
  const adapter = new OpenCodeAdapter();
  const input = createRunInput();

  const report = await adapter.normalize(input, {
    ...createArtifacts(),
    rawSession: {
      info: { id: "ses_123" },
      messages: [
        {
          info: {
            role: "assistant",
            path: {
              cwd: "/tmp/isolated-workspace",
              root: "/tmp/isolated-workspace",
            },
          },
          parts: [
            {
              type: "tool",
              tool: "read",
              state: {
                input: { filePath: "docs/guide.md" },
              },
            },
          ],
        },
      ],
    },
  });

  expect(report.files.observedReads).toEqual(["/tmp/isolated-workspace/docs/guide.md"]);
  expect(report.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "fileRead", path: "/tmp/isolated-workspace/docs/guide.md" }),
  ]));
});

test("OpenCodeAdapter run seeds isolated runtime and auth file", async () => {
  const tempDir = await createTempDir();
  const previousHome = process.env.HOME;
  const fakeHome = path.join(tempDir, "home");
  const authSourcePath = path.join(fakeHome, ".local", "share", "opencode", "auth.json");
  await mkdir(path.dirname(authSourcePath), { recursive: true });
  await writeFile(authSourcePath, '{"provider":"token"}\n', "utf8");
  process.env.HOME = fakeHome;

  try {
    const adapter = new RecordingRunOpenCodeAdapter({ type: "opencode", model: "openai/gpt-5" });
    const input = {
      ...createRunInput(),
      cwd: tempDir,
      artifactsDir: path.join(tempDir, "artifacts"),
    } satisfies RunInput;

    await adapter.run(input);

    expect(adapter.lastEnv).toMatchObject({
      XDG_DATA_HOME: path.join(input.artifactsDir, "opencode-xdg", "data"),
      XDG_CONFIG_HOME: path.join(input.artifactsDir, "opencode-xdg", "config"),
      XDG_STATE_HOME: path.join(input.artifactsDir, "opencode-xdg", "state"),
      XDG_CACHE_HOME: path.join(input.artifactsDir, "opencode-xdg", "cache"),
    });
    expect(await readFile(path.join(input.artifactsDir, "opencode-xdg", "data", "opencode", "auth.json"), "utf8")).toBe('{"provider":"token"}\n');
  } finally {
    process.env.HOME = previousHome;
  }
});

function createRunInput(): RunInput {
  return {
    runner: {
      id: "open-main",
      pathKey: "open-main",
      agent: {
        type: "opencode",
        model: "openai/gpt-5",
      },
    },
    prompt: "solve it",
    cwd: "/tmp/workspace",
    timeoutMs: 5_000,
    artifactsDir: "/tmp/artifacts",
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
    sessionId: "ses_fallback",
  };
}

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-opencode-"));
  tempDirs.push(tempDir);
  return tempDir;
}

class ExportingOpenCodeAdapter extends OpenCodeAdapter {
  exportEnv?: Record<string, string>;

  constructor(private readonly testOptions: { exportStdout: string }) {
    super();
  }

  protected override async runCommand(
    command: string,
    args: string[],
    input: RunInput,
    options?: { env?: Record<string, string> },
  ) {
    expect(command).toBe("opencode");
    expect(args).toEqual(["export", "ses_123"]);
    this.exportEnv = options?.env;

    const stdoutPath = path.join(input.artifactsDir, "stdout.log");
    const stderrPath = path.join(input.artifactsDir, "stderr.log");
    await mkdir(input.artifactsDir, { recursive: true });
    await writeFile(stdoutPath, this.testOptions.exportStdout, "utf8");
    await writeFile(stderrPath, "", "utf8");

    return {
      startedAt: "2026-04-03T10:00:00.000Z",
      endedAt: "2026-04-03T10:00:01.000Z",
      durationMs: 1_000,
      stdoutPath,
      stderrPath,
      stdout: this.testOptions.exportStdout,
      stderr: "",
    };
  }
}

class RecordingRunOpenCodeAdapter extends OpenCodeAdapter {
  lastEnv?: Record<string, string>;

  protected override async runCommand(
    _command: string,
    _args: string[],
    input: RunInput,
    options?: { env?: Record<string, string> },
  ) {
    this.lastEnv = options?.env;
    const stdoutPath = path.join(input.artifactsDir, "stdout.log");
    const stderrPath = path.join(input.artifactsDir, "stderr.log");
    await mkdir(input.artifactsDir, { recursive: true });
    await writeFile(stdoutPath, "session ready: ses_123\n", "utf8");
    await writeFile(stderrPath, "", "utf8");

    return {
      startedAt: "2026-04-03T10:00:00.000Z",
      endedAt: "2026-04-03T10:00:01.000Z",
      durationMs: 1_000,
      stdoutPath,
      stderrPath,
      stdout: "session ready: ses_123\n",
      stderr: "",
    };
  }
}
