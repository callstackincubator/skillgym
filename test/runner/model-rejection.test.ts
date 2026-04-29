import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import type { RunnerResult } from "../../src/domain/result.js";
import { isModelRejectedResult } from "../../src/runner/model-rejection.js";
import { createRunnerInfo } from "../../src/runner/runner-info.js";
import { createSessionReport } from "../helpers/session-report.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })));
});

test("classifies OpenCode missing model output", async () => {
  const result = await createResultWithLogs({
    runnerId: "open",
    agent: { type: "opencode", model: "openai/gpt-5" },
    stdout: '{"type":"error","timestamp":1777443880454,"sessionID":"ses","error":{"name":"UnknownError","data":{"message":"Model not found: skillgym-fake-model-do-not-use/."}}}\n',
    stderr: "ProviderModelNotFoundError: ProviderModelNotFoundError\n",
  });

  await expect(isModelRejectedResult(result)).resolves.toBe(true);
});

test("classifies Codex unsupported model output", async () => {
  const result = await createResultWithLogs({
    runnerId: "code",
    agent: { type: "codex", model: "gpt-5" },
    stdout: [
      '{"type":"thread.started","thread_id":"x"}',
      '{"type":"turn.started"}',
      '{"type":"error","message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'skillgym-fake-model-do-not-use\' model is not supported when using Codex with a ChatGPT account.\\"}}"}',
      '{"type":"turn.failed","error":{"message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'skillgym-fake-model-do-not-use\' model is not supported when using Codex with a ChatGPT account.\\"}}"}}',
    ].join("\n"),
    stderr: "Reading additional input from stdin...\n",
  });

  await expect(isModelRejectedResult(result)).resolves.toBe(true);
});

test("classifies Claude Code invalid model output", async () => {
  const result = await createResultWithLogs({
    runnerId: "claude",
    agent: { type: "claude-code", model: "claude-sonnet-4-6" },
    stdout: [
      '{"type":"system","subtype":"init","model":"skillgym-fake-model-do-not-use"}',
      '{"type":"assistant","error":"invalid_request","message":{"content":[{"type":"text","text":"There\'s an issue with the selected model (skillgym-fake-model-do-not-use). It may not exist or you may not have access to it. Run --model to pick a different model."}]}}',
      '{"type":"result","subtype":"success","is_error":true,"api_error_status":404,"result":"There\'s an issue with the selected model (skillgym-fake-model-do-not-use). It may not exist or you may not have access to it. Run --model to pick a different model.","total_cost_usd":0,"usage":{"input_tokens":0,"output_tokens":0},"modelUsage":{}}',
    ].join("\n"),
    stderr: "",
  });

  await expect(isModelRejectedResult(result)).resolves.toBe(true);
});

test("classifies Cursor Agent invalid model stderr", async () => {
  const result = await createResultWithLogs({
    runnerId: "cursor",
    agent: { type: "cursor-agent", model: "composer-2-fast" },
    stdout: "",
    stderr: "Cannot use this model: skillgym-fake-model-do-not-use. Available models: auto, composer-2-fast\n",
  });

  await expect(isModelRejectedResult(result)).resolves.toBe(true);
});

test("does not classify generic runner crash as model rejection", async () => {
  const result = await createResultWithLogs({
    runnerId: "open",
    agent: { type: "opencode", model: "openai/gpt-5" },
    stdout: "",
    stderr: "permission denied\n",
    errorMessage: "Command failed: opencode run",
  });

  await expect(isModelRejectedResult(result)).resolves.toBe(false);
});

async function createResultWithLogs(options: {
  runnerId: string;
  agent: RunnerResult["runner"]["agent"];
  stdout: string;
  stderr: string;
  errorMessage?: string;
}): Promise<RunnerResult> {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-model-rejection-"));
  tempDirs.push(artifactDir);
  await Promise.all([
    writeFile(path.join(artifactDir, "stdout.log"), options.stdout, "utf8"),
    writeFile(path.join(artifactDir, "stderr.log"), options.stderr, "utf8"),
  ]);

  const runner = createRunnerInfo(options.runnerId, options.agent);
  return {
    runner,
    passed: false,
    durationMs: 1,
    artifactDir,
    error: {
      name: "Error",
      message: options.errorMessage ?? "runner failed",
    },
    failureType: "runner-crash",
    failureOrigin: "runner",
    report: createSessionReport({ runner }),
  };
}
