import { expect, test } from "vitest";
import type { RunHandle, RunInput } from "../../src/domain/adapter.js";
import { CodexAdapter } from "../../src/adapters/codex.js";
import { OpenCodeAdapter } from "../../src/adapters/opencode.js";

test("OpenCodeAdapter passes configured model to opencode run", async () => {
  const adapter = new RecordingOpenCodeAdapter({
    type: "opencode",
    commandArgs: ["--pure"],
    model: "openai/gpt-5",
  });

  await adapter.run(createRunInput());

  expect(adapter.lastCall).toEqual({
    command: "opencode",
    args: ["--pure", "run", "--model", "openai/gpt-5", "--format", "json", "--thinking", "solve it"],
  });
  expect(adapter.lastEnv).toMatchObject({
    XDG_DATA_HOME: "/tmp/artifacts/opencode-xdg/data",
    XDG_CONFIG_HOME: "/tmp/artifacts/opencode-xdg/config",
    XDG_STATE_HOME: "/tmp/artifacts/opencode-xdg/state",
    XDG_CACHE_HOME: "/tmp/artifacts/opencode-xdg/cache",
  });
});

test("CodexAdapter passes configured model to codex exec", async () => {
  const adapter = new RecordingCodexAdapter({
    type: "codex",
    commandArgs: ["--yes"],
    model: "gpt-5",
  });

  await adapter.run(createRunInput());

  expect(adapter.lastCall).toEqual({
    command: "npx",
    args: ["--yes", "codex", "exec", "--model", "gpt-5", "--json", "--skip-git-repo-check", "-C", "/tmp/workspace", "solve it"],
  });
  expect(adapter.lastEnv).toMatchObject({
    CODEX_HOME: "/tmp/artifacts/codex-home",
    CODEX_SQLITE_HOME: "/tmp/artifacts/codex-home/sqlite",
  });
});

function createRunInput(): RunInput {
  return {
    runner: {
      id: "runner-id",
      pathKey: "runner-id",
      agent: {
        type: "codex",
        model: "gpt-5",
      },
    },
    prompt: "solve it",
    cwd: "/tmp/workspace",
    timeoutMs: 5_000,
    artifactsDir: "/tmp/artifacts",
  };
}

class RecordingOpenCodeAdapter extends OpenCodeAdapter {
  lastCall?: { command: string; args: string[] };
  lastEnv?: Record<string, string>;

  protected override async runCommand(
    command: string,
    args: string[],
    _input: RunInput,
    options?: { env?: Record<string, string> },
  ): Promise<RunHandle & { stdout: string; stderr: string }> {
    this.lastCall = { command, args };
    this.lastEnv = options?.env;
    return createRunHandle();
  }
}

class RecordingCodexAdapter extends CodexAdapter {
  lastCall?: { command: string; args: string[] };
  lastEnv?: Record<string, string>;

  protected override async runCommand(
    command: string,
    args: string[],
    _input: RunInput,
    options?: { env?: Record<string, string> },
  ): Promise<RunHandle & { stdout: string; stderr: string }> {
    this.lastCall = { command, args };
    this.lastEnv = options?.env;
    return createRunHandle();
  }
}

function createRunHandle(): RunHandle & { stdout: string; stderr: string } {
  return {
    startedAt: "2026-04-03T10:00:00.000Z",
    endedAt: "2026-04-03T10:00:01.000Z",
    durationMs: 1_000,
    stdoutPath: "/tmp/stdout.log",
    stderrPath: "/tmp/stderr.log",
    stdout: "",
    stderr: "",
  };
}
