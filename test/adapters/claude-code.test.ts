import { mkdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code.js";
import type { RunHandle, RunInput } from "../../src/domain/adapter.js";
import type { JudgeInput } from "../../src/domain/judge.js";

test("ClaudeCodeAdapter judge uses read-only flags and temp cwd", async () => {
  const adapter = new RecordingJudgeClaudeCodeAdapter(
    '{"verdict":"pass","score":1,"reason":"meets rubric"}',
  );

  const verdict = await adapter.judge(createJudgeInput());

  expect(verdict).toEqual({
    verdict: "pass",
    score: 1,
    reason: "meets rubric",
  });
  expect(adapter.calls).toHaveLength(1);
  expect(adapter.calls[0]).toMatchObject({
    command: "claude",
    input: {
      prompt: "Return verdict JSON.",
      timeoutMs: 5_000,
      showRunnerOutput: false,
    },
  });
  expect(adapter.calls[0]?.input.cwd).not.toBe(process.cwd());
  expect(adapter.calls[0]?.input.cwd).toContain(os.tmpdir());
  expect(adapter.calls[0]?.args).toEqual([
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--bare",
    "--permission-mode",
    "plan",
    "--tools",
    "",
    "--model",
    "claude-sonnet-4-6",
    "Return verdict JSON.",
  ]);
  expect(adapter.calls[0]?.args).not.toContain("--dangerously-skip-permissions");
  await expect(stat(adapter.calls[0]!.input.cwd)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(stat(adapter.calls[0]!.input.artifactsDir)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

test("ClaudeCodeAdapter judge parses stream-json final output", async () => {
  const adapter = new RecordingJudgeClaudeCodeAdapter(
    '{"verdict":"fail","score":0.25,"reason":"missing required step"}',
  );

  await expect(adapter.judge(createJudgeInput({ model: "claude-haiku-4-5" }))).resolves.toEqual({
    verdict: "fail",
    score: 0.25,
    reason: "missing required step",
  });
  expect(adapter.calls[0]?.args).toContain("claude-haiku-4-5");
});

function createJudgeInput(overrides: Partial<JudgeInput> = {}): JudgeInput {
  return {
    model: overrides.model ?? "claude-sonnet-4-6",
    prompt: overrides.prompt ?? "Return verdict JSON.",
    timeoutMs: overrides.timeoutMs ?? 5_000,
  };
}

class RecordingJudgeClaudeCodeAdapter extends ClaudeCodeAdapter {
  calls: Array<{
    command: string;
    args: string[];
    input: RunInput;
  }> = [];

  constructor(private readonly stdout: string) {
    super({ type: "claude-code", model: "claude-haiku-4-5" });
  }

  protected override async runCommand(
    command: string,
    args: string[],
    input: RunInput,
    _options?: { env?: Record<string, string> },
  ): Promise<RunHandle & { stdout: string; stderr: string }> {
    this.calls.push({ command, args, input });

    await mkdir(input.artifactsDir, { recursive: true });

    const stdoutPath = path.join(input.artifactsDir, "stdout.log");
    const stderrPath = path.join(input.artifactsDir, "stderr.log");
    await writeFile(
      stdoutPath,
      [
        JSON.stringify({ type: "system", session_id: "judge-session-1" }),
        JSON.stringify({
          type: "result",
          result: this.stdout,
          session_id: "judge-session-1",
          is_error: false,
        }),
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(stderrPath, "", "utf8");

    return {
      startedAt: "2026-05-07T10:00:00.000Z",
      endedAt: "2026-05-07T10:00:01.000Z",
      durationMs: 1_000,
      stdoutPath,
      stderrPath,
      stdout: this.stdout,
      stderr: "",
    };
  }
}
