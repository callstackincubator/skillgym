import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code.js";
import { CodexAdapter } from "../../src/adapters/codex.js";
import { CursorAgentAdapter } from "../../src/adapters/cursor-agent.js";
import { OpenCodeAdapter } from "../../src/adapters/opencode.js";
import type { ExplainInput, RunHandle, RunInput } from "../../src/domain/adapter.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })),
  );
});

test("OpenCodeAdapter explain resumes a session and reuses the original runtime root", async () => {
  const artifactDir = await createTempDir();
  const adapter = new RecordingExplainOpenCodeAdapter();

  const result = await adapter.explain(createExplainInput({ artifactDir, sessionId: "ses_123" }));

  expect(adapter.calls).toHaveLength(2);
  expect(adapter.calls[0]).toMatchObject({
    command: "opencode",
    args: [
      "run",
      "--model",
      "openai/gpt-5",
      "--session",
      "ses_123",
      "--format",
      "json",
      "--thinking",
      "Why did you skip SKILL.md?",
    ],
  });
  expect(adapter.calls[1]).toMatchObject({
    command: "opencode",
    args: ["export", "ses_123"],
  });
  expect(adapter.calls[0]?.env).toMatchObject({
    XDG_DATA_HOME: path.join(artifactDir, "opencode-xdg", "data"),
    XDG_CONFIG_HOME: path.join(artifactDir, "opencode-xdg", "config"),
    XDG_STATE_HOME: path.join(artifactDir, "opencode-xdg", "state"),
    XDG_CACHE_HOME: path.join(artifactDir, "opencode-xdg", "cache"),
  });
  expect(result.answers[0]?.answer).toBe("Because I inferred the task from context.");
});

test("CodexAdapter explain resumes a thread and normalizes the response", async () => {
  const artifactDir = await createTempDir();
  const adapter = new RecordingExplainCodexAdapter();

  const result = await adapter.explain(
    createExplainInput({ artifactDir, sessionId: "thread_123" }),
  );

  expect(adapter.calls).toHaveLength(1);
  expect(adapter.calls[0]).toMatchObject({
    command: "npx",
    args: ["codex", "exec", "resume", "thread_123", "Why did you skip SKILL.md?", "--json"],
  });
  expect(adapter.calls[0]?.env).toMatchObject({
    CODEX_HOME: path.join(artifactDir, "codex-home"),
    CODEX_SQLITE_HOME: path.join(artifactDir, "codex-home", "sqlite"),
  });
  expect(result.answers[0]).toMatchObject({
    answer: "Because I used the prompt as sufficient context.",
    sessionId: "thread_123",
  });
});

test("ClaudeCodeAdapter run keeps session persistence enabled for later explain", async () => {
  const adapter = new RecordingExplainClaudeCodeAdapter();

  await adapter.run(createRunInput({ type: "claude-code", model: "claude-sonnet-4-6" }));

  expect(adapter.calls[0]?.args).not.toContain("--no-session-persistence");
});

test("ClaudeCodeAdapter explain resumes a session with -r", async () => {
  const adapter = new RecordingExplainClaudeCodeAdapter();

  const result = await adapter.explain(
    createExplainInput({
      runner: createRunInput({ type: "claude-code", model: "claude-sonnet-4-6" }).runner,
      artifactDir: "/tmp/claude-artifacts",
      sessionId: "claude-session-1",
    }),
  );

  expect(adapter.calls[0]).toMatchObject({
    command: "claude",
    args: [
      "-p",
      "-r",
      "claude-session-1",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--model",
      "claude-sonnet-4-6",
      "Why did you skip SKILL.md?",
    ],
  });
  expect(result.answers[0]?.answer).toBe("Because the prompt looked self-contained.");
});

test("CursorAgentAdapter explain resumes a chat", async () => {
  const adapter = new RecordingExplainCursorAgentAdapter();

  const result = await adapter.explain(
    createExplainInput({
      runner: createRunInput({ type: "cursor-agent", model: "composer-2-fast" }).runner,
      artifactDir: "/tmp/cursor-artifacts",
      sessionId: "chat_123",
    }),
  );

  expect(adapter.calls[0]).toMatchObject({
    command: "agent",
    args: [
      "-p",
      "--output-format",
      "stream-json",
      "--trust",
      "--force",
      "--workspace",
      "/tmp/workspace",
      "--resume",
      "chat_123",
      "--model",
      "composer-2-fast",
      "Why did you skip SKILL.md?",
    ],
  });
  expect(result.answers[0]?.answer).toBe("Because I prioritized the direct user request.");
});

function createRunInput(options: {
  type: "opencode" | "codex" | "claude-code" | "cursor-agent";
  model: string;
}): RunInput {
  return {
    runner: {
      id: `${options.type}-main`,
      pathKey: `${options.type}-main`,
      agent: {
        type: options.type,
        model: options.model,
      },
    },
    prompt: "solve it",
    cwd: "/tmp/workspace",
    timeoutMs: 5_000,
    artifactsDir: "/tmp/artifacts",
  };
}

function createExplainInput(
  overrides: Partial<ExplainInput> & { artifactDir: string; sessionId: string },
): ExplainInput {
  return {
    runner: overrides.runner ?? createRunInput({ type: "opencode", model: "openai/gpt-5" }).runner,
    cwd: overrides.cwd ?? "/tmp/workspace",
    timeoutMs: overrides.timeoutMs ?? 5_000,
    artifactDir: overrides.artifactDir,
    sessionId: overrides.sessionId,
    questions: overrides.questions ?? [
      {
        question: "Why did you skip SKILL.md?",
        source: {
          filePath: "/tmp/skillgym/suite.ts",
          line: "12",
          column: "5",
        },
      },
    ],
    showRunnerOutput: overrides.showRunnerOutput,
  };
}

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-explain-"));
  tempDirs.push(tempDir);
  return tempDir;
}

class RecordingExplainOpenCodeAdapter extends OpenCodeAdapter {
  calls: Array<{ command: string; args: string[]; env?: Record<string, string> }> = [];

  protected override async runCommand(
    command: string,
    args: string[],
    input: RunInput,
    options?: { env?: Record<string, string> },
  ): Promise<RunHandle & { stdout: string; stderr: string }> {
    this.calls.push({ command, args, env: options?.env });

    const stdoutPath = path.join(input.artifactsDir, "stdout.log");
    const stderrPath = path.join(input.artifactsDir, "stderr.log");
    await mkdir(input.artifactsDir, { recursive: true });

    const stdout =
      args[0] === "export"
        ? JSON.stringify({
            info: { id: "ses_123" },
            messages: [
              {
                info: { role: "assistant" },
                parts: [{ type: "text", text: "Because I inferred the task from context." }],
              },
            ],
          })
        : "session ready: ses_123\n";

    await writeFile(stdoutPath, stdout, "utf8");
    await writeFile(stderrPath, "", "utf8");

    return {
      startedAt: "2026-05-07T10:00:00.000Z",
      endedAt: "2026-05-07T10:00:01.000Z",
      durationMs: 1_000,
      stdoutPath,
      stderrPath,
      stdout,
      stderr: "",
    };
  }
}

class RecordingExplainCodexAdapter extends CodexAdapter {
  calls: Array<{ command: string; args: string[]; env?: Record<string, string> }> = [];

  protected override async runCommand(
    command: string,
    args: string[],
    input: RunInput,
    options?: { env?: Record<string, string> },
  ): Promise<RunHandle & { stdout: string; stderr: string }> {
    this.calls.push({ command, args, env: options?.env });

    const stdoutPath = path.join(input.artifactsDir, "stdout.log");
    const stderrPath = path.join(input.artifactsDir, "stderr.log");
    await mkdir(input.artifactsDir, { recursive: true });
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "thread_123" }),
      JSON.stringify({
        timestamp: "2026-05-07T10:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          text: "Because I used the prompt as sufficient context.",
          phase: "final_answer",
        },
      }),
      "",
    ].join("\n");
    await writeFile(stdoutPath, stdout, "utf8");
    await writeFile(stderrPath, "", "utf8");

    return {
      startedAt: "2026-05-07T10:00:00.000Z",
      endedAt: "2026-05-07T10:00:01.000Z",
      durationMs: 1_000,
      stdoutPath,
      stderrPath,
      stdout,
      stderr: "",
    };
  }
}

class RecordingExplainClaudeCodeAdapter extends ClaudeCodeAdapter {
  calls: Array<{ command: string; args: string[] }> = [];

  protected override async runCommand(
    command: string,
    args: string[],
    input: RunInput,
  ): Promise<RunHandle & { stdout: string; stderr: string }> {
    this.calls.push({ command, args });

    const stdoutPath = path.join(input.artifactsDir, "stdout.log");
    const stderrPath = path.join(input.artifactsDir, "stderr.log");
    await mkdir(input.artifactsDir, { recursive: true });
    const stdout = [
      JSON.stringify({ type: "system", session_id: "claude-session-1" }),
      JSON.stringify({
        type: "result",
        result: "Because the prompt looked self-contained.",
        session_id: "claude-session-1",
        is_error: false,
      }),
      "",
    ].join("\n");
    await writeFile(stdoutPath, stdout, "utf8");
    await writeFile(stderrPath, "", "utf8");

    return {
      startedAt: "2026-05-07T10:00:00.000Z",
      endedAt: "2026-05-07T10:00:01.000Z",
      durationMs: 1_000,
      stdoutPath,
      stderrPath,
      stdout,
      stderr: "",
    };
  }
}

class RecordingExplainCursorAgentAdapter extends CursorAgentAdapter {
  calls: Array<{ command: string; args: string[] }> = [];

  protected override async runCommand(
    command: string,
    args: string[],
    input: RunInput,
  ): Promise<RunHandle & { stdout: string; stderr: string }> {
    this.calls.push({ command, args });

    const stdoutPath = path.join(input.artifactsDir, "stdout.log");
    const stderrPath = path.join(input.artifactsDir, "stderr.log");
    await mkdir(input.artifactsDir, { recursive: true });
    const stdout = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "chat_123",
        cwd: "/tmp/workspace",
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: "chat_123",
        result: "Because I prioritized the direct user request.",
      }),
      "",
    ].join("\n");
    await writeFile(stdoutPath, stdout, "utf8");
    await writeFile(stderrPath, "", "utf8");

    return {
      startedAt: "2026-05-07T10:00:00.000Z",
      endedAt: "2026-05-07T10:00:01.000Z",
      durationMs: 1_000,
      stdoutPath,
      stderrPath,
      stdout,
      stderr: "",
    };
  }
}
