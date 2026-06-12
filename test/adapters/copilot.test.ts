import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { CopilotAdapter } from "../../src/adapters/copilot.js";
import type {
  ExplainInput,
  RawRunArtifacts,
  RunHandle,
  RunInput,
} from "../../src/domain/adapter.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })),
  );
});

test("CopilotAdapter run uses JSONL prompt mode with isolated state", async () => {
  const adapter = new RecordingRunCopilotAdapter({
    type: "copilot",
    commandArgs: ["--experimental"],
    model: "gpt-5.4-mini",
  });
  const input = createRunInput();

  await adapter.run(input);

  expect(adapter.lastCommand).toBe("copilot");
  expect(adapter.lastArgs).toEqual([
    "--experimental",
    "-p",
    "solve it",
    "--model",
    "gpt-5.4-mini",
    "--output-format",
    "json",
    "--stream",
    "on",
    "--no-auto-update",
    "--no-custom-instructions",
    "--disable-builtin-mcps",
    "--no-remote",
    "--allow-all-tools",
    "--disallow-temp-dir",
    "-C",
    "/tmp/workspace",
  ]);
  expect(adapter.lastEnv).toMatchObject({
    COPILOT_HOME: "/tmp/artifacts/copilot-home",
    COPILOT_AUTO_UPDATE: "false",
    NO_COLOR: "1",
    COPILOT_OTEL_FILE_EXPORTER_PATH: "/tmp/artifacts/copilot-otel.jsonl",
  });
});

test("CopilotAdapter collect saves stdout stream and telemetry artifacts", async () => {
  const tempDir = await createTempDir();
  const adapter = new CopilotAdapter();
  const input = {
    ...createRunInput(),
    artifactsDir: path.join(tempDir, "artifacts"),
  } satisfies RunInput;
  const stdoutPath = path.join(tempDir, "stdout.log");
  const stderrPath = path.join(tempDir, "stderr.log");
  const stdout = [
    JSON.stringify({ type: "assistant.message", data: { content: "done" } }),
    JSON.stringify({ type: "result", sessionId: "session_123", usage: { premiumRequests: 0.33 } }),
    "",
  ].join("\n");
  const telemetry = [
    JSON.stringify({
      type: "span",
      name: "invoke_agent",
      attributes: {
        "gen_ai.usage.input_tokens": 120,
        "gen_ai.usage.output_tokens": 30,
        "gen_ai.usage.reasoning_output_tokens": 10,
        "gen_ai.usage.cache_read_input_tokens": 20,
      },
    }),
    "",
  ].join("\n");

  await mkdir(input.artifactsDir, { recursive: true });
  await writeFile(stdoutPath, stdout, "utf8");
  await writeFile(stderrPath, "", "utf8");
  await writeFile(path.join(input.artifactsDir, "copilot-otel.jsonl"), telemetry, "utf8");

  const artifacts = await adapter.collect(
    {
      startedAt: "2026-06-11T10:00:00.000Z",
      endedAt: "2026-06-11T10:00:01.000Z",
      durationMs: 1_000,
      stdoutPath,
      stderrPath,
    },
    input,
  );

  expect(artifacts.sessionId).toBe("session_123");
  expect(artifacts.exportPath).toBe(path.join(input.artifactsDir, "session.stream.jsonl"));
  expect(artifacts.telemetryPath).toBe(path.join(input.artifactsDir, "copilot-otel.jsonl"));
  expect(await readFile(artifacts.exportPath!, "utf8")).toBe(stdout);
  expect(await readFile(artifacts.telemetryPath!, "utf8")).toBe(telemetry);
  expect(artifacts.rawSession).toEqual({
    records: [
      { type: "assistant.message", data: { content: "done" } },
      { type: "result", sessionId: "session_123", usage: { premiumRequests: 0.33 } },
    ],
    telemetryRecords: [
      {
        type: "span",
        name: "invoke_agent",
        attributes: {
          "gen_ai.usage.input_tokens": 120,
          "gen_ai.usage.output_tokens": 30,
          "gen_ai.usage.reasoning_output_tokens": 10,
          "gen_ai.usage.cache_read_input_tokens": 20,
        },
      },
    ],
  });
});

test("CopilotAdapter normalize extracts messages, tools, reads, commands, and OTel usage", async () => {
  const adapter = new CopilotAdapter();
  const input = createRunInput();

  const report = await adapter.normalize(input, {
    ...createArtifacts(),
    sessionId: "session_123",
    telemetryPath: "/tmp/artifacts/copilot-otel.jsonl",
    rawSession: {
      records: [
        {
          type: "user.message",
          timestamp: "2026-06-11T10:00:00.000Z",
          data: { content: "read the skill" },
        },
        {
          type: "tool.execution_start",
          timestamp: "2026-06-11T10:00:00.500Z",
          data: {
            toolCallId: "call_skill",
            toolName: "skill",
            arguments: { skill: "find-skills" },
          },
        },
        {
          type: "tool.execution_complete",
          timestamp: "2026-06-11T10:00:00.750Z",
          data: {
            toolCallId: "call_skill",
            success: true,
            result: { content: 'Skill "find-skills" loaded successfully.' },
          },
        },
        {
          type: "tool.execution_start",
          timestamp: "2026-06-11T10:00:01.000Z",
          data: {
            toolCallId: "call_1",
            toolName: "view",
            arguments: { path: "skills/find-skills/SKILL.md" },
          },
        },
        {
          type: "tool.execution_complete",
          timestamp: "2026-06-11T10:00:02.000Z",
          data: {
            toolCallId: "call_1",
            success: true,
            result: { content: "1. # skill", detailedContent: "# skill" },
          },
        },
        {
          type: "tool.execution_start",
          timestamp: "2026-06-11T10:00:03.000Z",
          data: {
            toolCallId: "call_2",
            toolName: "bash",
            arguments: { command: "sed -n '1,80p' package.json" },
          },
        },
        {
          type: "tool.execution_complete",
          timestamp: "2026-06-11T10:00:04.000Z",
          data: {
            toolCallId: "call_2",
            success: false,
            error: { message: "Permission denied", code: "denied" },
          },
        },
        {
          type: "assistant.message",
          timestamp: "2026-06-11T10:00:05.000Z",
          data: { messageId: "msg_1", phase: "final_answer", content: "done" },
        },
      ],
      telemetryRecords: [
        {
          type: "span",
          name: "chat gpt-5.4-mini",
          attributes: {
            "gen_ai.usage.input_tokens": 999,
            "gen_ai.usage.output_tokens": 999,
          },
        },
        {
          type: "span",
          name: "invoke_agent",
          attributes: {
            "gen_ai.usage.input_tokens": 200,
            "gen_ai.usage.output_tokens": 50,
            "gen_ai.usage.reasoning_output_tokens": 25,
            "gen_ai.usage.cache_read_input_tokens": 75,
          },
        },
      ],
    },
  });

  expect(report.sessionId).toBe("session_123");
  expect(report.finalOutput).toBe("done");
  expect(report.usage.inputTokens).toBe(200);
  expect(report.usage.outputTokens).toBe(50);
  expect(report.usage.reasoningTokens).toBe(25);
  expect(report.usage.cacheTokens).toBe(75);
  expect(report.usage.totalTokens).toBe(200);
  expect(report.files.observedReads).toEqual(["/tmp/workspace/skills/find-skills/SKILL.md"]);
  expect(report.detectedSkills).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ skill: "find-skills", confidence: "explicit" }),
    ]),
  );
  expect(report.rawArtifacts.telemetryPath).toBe("/tmp/artifacts/copilot-otel.jsonl");
  expect(report.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "toolCall", tool: "view" }),
      expect.objectContaining({ type: "toolCall", tool: "skill" }),
      expect.objectContaining({ type: "skillSignal", skill: "find-skills" }),
      expect.objectContaining({ type: "toolCall", tool: "bash" }),
      expect.objectContaining({ type: "toolResult", tool: "view", output: "# skill" }),
      expect.objectContaining({ type: "toolResult", tool: "bash", output: "Permission denied" }),
      expect.objectContaining({
        type: "command",
        command: "sed -n '1,80p' package.json",
      }),
      expect.objectContaining({
        type: "fileRead",
        path: "/tmp/workspace/skills/find-skills/SKILL.md",
      }),
    ]),
  );
});

test("CopilotAdapter explain resumes a session and reuses the original runtime root", async () => {
  const artifactDir = await createTempDir();
  const adapter = new RecordingExplainCopilotAdapter();

  const result = await adapter.explain(
    createExplainInput({ artifactDir, sessionId: "copilot-session-1" }),
  );

  expect(adapter.calls).toHaveLength(1);
  expect(adapter.calls[0]).toMatchObject({
    command: "copilot",
    args: [
      "-p",
      "Why did you skip SKILL.md?",
      "--resume=copilot-session-1",
      "--model",
      "gpt-5.4-mini",
      "--output-format",
      "json",
      "--stream",
      "on",
      "--no-auto-update",
      "--no-custom-instructions",
      "--disable-builtin-mcps",
      "--no-remote",
      "--allow-all-tools",
      "--disallow-temp-dir",
      "-C",
      "/tmp/workspace",
    ],
  });
  expect(adapter.calls[0]?.env).toMatchObject({
    COPILOT_HOME: path.join(artifactDir, "copilot-home"),
    COPILOT_OTEL_FILE_EXPORTER_PATH: path.join(
      artifactDir,
      "explain",
      "question-01",
      "copilot-otel.jsonl",
    ),
  });
  expect(result.answers[0]).toMatchObject({
    answer: "Because the prompt looked self-contained.",
    sessionId: "copilot-session-1",
  });
});

function createRunInput(): RunInput {
  return {
    runner: {
      id: "copilot-main",
      pathKey: "copilot-main",
      agent: {
        type: "copilot",
        model: "gpt-5.4-mini",
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
    startedAt: "2026-06-11T10:00:00.000Z",
    endedAt: "2026-06-11T10:00:01.000Z",
    durationMs: 1_000,
  };
}

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-copilot-"));
  tempDirs.push(tempDir);
  return tempDir;
}

function createExplainInput(
  overrides: Partial<ExplainInput> & { artifactDir: string; sessionId: string },
): ExplainInput {
  return {
    runner: overrides.runner ?? createRunInput().runner,
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

class RecordingRunCopilotAdapter extends CopilotAdapter {
  lastCommand?: string;
  lastArgs?: string[];
  lastEnv?: Record<string, string>;

  protected override async runCommand(
    command: string,
    args: string[],
    input: RunInput,
    options?: { env?: Record<string, string> },
  ): Promise<RunHandle & { stdout: string; stderr: string }> {
    this.lastCommand = command;
    this.lastArgs = args;
    this.lastEnv = options?.env;

    const stdoutPath = path.join(input.artifactsDir, "stdout.log");
    const stderrPath = path.join(input.artifactsDir, "stderr.log");
    await mkdir(input.artifactsDir, { recursive: true });
    await writeFile(stdoutPath, "", "utf8");
    await writeFile(stderrPath, "", "utf8");

    return {
      startedAt: "2026-06-11T10:00:00.000Z",
      endedAt: "2026-06-11T10:00:01.000Z",
      durationMs: 1_000,
      stdoutPath,
      stderrPath,
      stdout: "",
      stderr: "",
    };
  }
}

class RecordingExplainCopilotAdapter extends CopilotAdapter {
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
      JSON.stringify({
        type: "assistant.message",
        data: {
          messageId: "msg_1",
          content: "Because the prompt looked self-contained.",
          phase: "final_answer",
        },
      }),
      JSON.stringify({ type: "result", sessionId: "copilot-session-1", exitCode: 0 }),
      "",
    ].join("\n");
    await writeFile(stdoutPath, stdout, "utf8");
    await writeFile(stderrPath, "", "utf8");

    return {
      startedAt: "2026-06-11T10:00:00.000Z",
      endedAt: "2026-06-11T10:00:01.000Z",
      durationMs: 1_000,
      stdoutPath,
      stderrPath,
      stdout,
      stderr: "",
    };
  }
}
