import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { CursorAgentAdapter } from "../../src/adapters/cursor-agent.js";
import type { RawRunArtifacts, RunInput } from "../../src/domain/adapter.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })));
});

test("CursorAgentAdapter run uses stream-json headless mode", async () => {
  const adapter = new RecordingRunCursorAgentAdapter({ type: "cursor-agent", model: "composer-2-fast" });
  const input = createRunInput();

  await adapter.run(input);

  expect(adapter.lastCommand).toBe("agent");
  expect(adapter.lastArgs).toEqual([
    "-p",
    "--output-format",
    "stream-json",
    "--trust",
    "--force",
    "--workspace",
    "/tmp/workspace",
    "--model",
    "composer-2-fast",
    "solve it",
  ]);
});

test("CursorAgentAdapter collect saves stdout as session stream jsonl", async () => {
  const tempDir = await createTempDir();
  const adapter = new CursorAgentAdapter();
  const input = {
    ...createRunInput(),
    artifactsDir: path.join(tempDir, "artifacts"),
  } satisfies RunInput;
  const stdoutPath = path.join(tempDir, "stdout.log");
  const stderrPath = path.join(tempDir, "stderr.log");
  const stdout = [
    JSON.stringify({ type: "system", subtype: "init", session_id: "chat_123", cwd: "/tmp/workspace" }),
    JSON.stringify({ type: "result", subtype: "success", result: "done", session_id: "chat_123" }),
    "",
  ].join("\n");

  await mkdir(tempDir, { recursive: true });
  await writeFile(stdoutPath, stdout, "utf8");
  await writeFile(stderrPath, "", "utf8");

  const artifacts = await adapter.collect(
    {
      startedAt: "2026-04-16T10:00:00.000Z",
      endedAt: "2026-04-16T10:00:01.000Z",
      durationMs: 1_000,
      stdoutPath,
      stderrPath,
    },
    input,
  );

  expect(artifacts.sessionId).toBe("chat_123");
  expect(artifacts.exportPath).toBe(path.join(input.artifactsDir, "session.stream.jsonl"));
  expect(await readFile(artifacts.exportPath!, "utf8")).toBe(stdout);
  expect(artifacts.rawSession).toEqual([
    { type: "system", subtype: "init", session_id: "chat_123", cwd: "/tmp/workspace" },
    { type: "result", subtype: "success", result: "done", session_id: "chat_123" },
  ]);
});

test("CursorAgentAdapter normalize extracts commands, file reads, tool results, and usage", async () => {
  const adapter = new CursorAgentAdapter();
  const input = createRunInput();

  const report = await adapter.normalize(input, {
    ...createArtifacts(),
    sessionId: "chat_123",
    rawSession: [
      {
        type: "system",
        subtype: "init",
        cwd: "/tmp/workspace",
        session_id: "chat_123",
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "read the skill" }],
        },
      },
      {
        type: "tool_call",
        subtype: "started",
        call_id: "tool_1",
        timestamp_ms: 1_776_333_599_552,
        tool_call: {
          shellToolCall: {
            args: {
              command: "sed -n '1,200p' skills/find-skills/SKILL.md",
              workingDirectory: "/tmp/workspace",
              description: "Read skill file",
            },
            description: "Read skill file",
          },
        },
      },
      {
        type: "tool_call",
        subtype: "completed",
        call_id: "tool_1",
        timestamp_ms: 1_776_333_600_057,
        tool_call: {
          shellToolCall: {
            args: {
              command: "sed -n '1,200p' skills/find-skills/SKILL.md",
              workingDirectory: "/tmp/workspace",
              description: "Read skill file",
            },
            result: {
              success: {
                command: "sed -n '1,200p' skills/find-skills/SKILL.md",
                stdout: "# skill",
                stderr: "",
                exitCode: 0,
              },
            },
            description: "Read skill file",
          },
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      },
      {
        type: "result",
        subtype: "success",
        result: "done",
        usage: {
          inputTokens: 200,
          outputTokens: 50,
          cacheReadTokens: 75,
          cacheWriteTokens: 0,
        },
      },
    ],
  });

  expect(report.sessionId).toBe("chat_123");
  expect(report.finalOutput).toBe("done");
  expect(report.usage.inputTokens).toBe(275);
  expect(report.usage.outputTokens).toBe(50);
  expect(report.usage.cacheTokens).toBe(75);
  expect(report.usage.totalTokens).toBe(250);
  expect(report.files.observedReads).toEqual([
    "/tmp/workspace/skills/find-skills/SKILL.md",
  ]);
  expect(report.detectedSkills).toEqual(expect.arrayContaining([
    expect.objectContaining({ skill: "find-skills" }),
  ]));
  expect(report.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "command", command: "sed -n '1,200p' skills/find-skills/SKILL.md" }),
    expect.objectContaining({ type: "fileRead", path: "/tmp/workspace/skills/find-skills/SKILL.md" }),
    expect.objectContaining({ type: "toolCall", tool: "shell" }),
    expect.objectContaining({ type: "toolResult", tool: "shell" }),
  ]));
});

test("CursorAgentAdapter normalize resolves shell reads against stored call workdir", async () => {
  const adapter = new CursorAgentAdapter();
  const input = createRunInput();

  const report = await adapter.normalize(input, {
    ...createArtifacts(),
    rawSession: [
      {
        type: "system",
        subtype: "init",
        cwd: "/tmp/workspace",
        session_id: "chat_123",
      },
      {
        type: "tool_call",
        subtype: "started",
        call_id: "tool_1",
        tool_call: {
          shellToolCall: {
            args: {
              workingDirectory: "/tmp/isolated-workspace",
              description: "Read skill file",
            },
          },
        },
      },
      {
        type: "tool_call",
        subtype: "completed",
        call_id: "tool_1",
        tool_call: {
          shellToolCall: {
            args: {
              command: "sed -n '1,200p' skills/find-skills/SKILL.md",
              description: "Read skill file",
            },
            result: {
              success: {
                command: "sed -n '1,200p' skills/find-skills/SKILL.md",
                stdout: "# skill",
                stderr: "",
                exitCode: 0,
              },
            },
          },
        },
      },
    ],
  });

  expect(report.files.observedReads).toEqual([
    "/tmp/isolated-workspace/skills/find-skills/SKILL.md",
  ]);
  expect(report.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "fileRead", path: "/tmp/isolated-workspace/skills/find-skills/SKILL.md" }),
  ]));
});

test("CursorAgentAdapter normalize resolves read tool calls against stored call cwd", async () => {
  const adapter = new CursorAgentAdapter();
  const input = createRunInput();

  const report = await adapter.normalize(input, {
    ...createArtifacts(),
    rawSession: [
      {
        type: "system",
        subtype: "init",
        cwd: "/tmp/workspace",
        session_id: "chat_123",
      },
      {
        type: "tool_call",
        subtype: "started",
        call_id: "tool_1",
        tool_call: {
          readToolCall: {
            args: {
              cwd: "/tmp/turn-workspace",
            },
          },
        },
      },
      {
        type: "tool_call",
        subtype: "completed",
        call_id: "tool_1",
        tool_call: {
          readToolCall: {
            args: {
              filePath: "skills/find-skills/SKILL.md",
            },
            result: "# skill",
          },
        },
      },
    ],
  });

  expect(report.files.observedReads).toEqual([
    "/tmp/turn-workspace/skills/find-skills/SKILL.md",
  ]);
  expect(report.detectedSkills).toEqual(expect.arrayContaining([
    expect.objectContaining({ skill: "find-skills" }),
  ]));
  expect(report.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "fileRead", path: "/tmp/turn-workspace/skills/find-skills/SKILL.md" }),
  ]));
});

function createRunInput(): RunInput {
  return {
    runner: {
      id: "cursor-main",
      pathKey: "cursor-main",
      agent: {
        type: "cursor-agent",
        model: "composer-2-fast",
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
    startedAt: "2026-04-16T10:00:00.000Z",
    endedAt: "2026-04-16T10:00:01.000Z",
    durationMs: 1_000,
  };
}

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-cursor-agent-"));
  tempDirs.push(tempDir);
  return tempDir;
}

class RecordingRunCursorAgentAdapter extends CursorAgentAdapter {
  lastCommand?: string;
  lastArgs?: string[];

  protected override async runCommand(
    command: string,
    args: string[],
    input: RunInput,
    _options?: { env?: Record<string, string> },
  ) {
    this.lastCommand = command;
    this.lastArgs = args;

    const stdoutPath = path.join(input.artifactsDir, "stdout.log");
    const stderrPath = path.join(input.artifactsDir, "stderr.log");
    await mkdir(input.artifactsDir, { recursive: true });
    await writeFile(stdoutPath, "", "utf8");
    await writeFile(stderrPath, "", "utf8");

    return {
      startedAt: "2026-04-16T10:00:00.000Z",
      endedAt: "2026-04-16T10:00:01.000Z",
      durationMs: 1_000,
      stdoutPath,
      stderrPath,
      stdout: "",
      stderr: "",
    };
  }
}
