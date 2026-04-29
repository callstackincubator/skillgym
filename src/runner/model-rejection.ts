import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RunnerResult } from "../domain/result.js";

export async function isModelRejectedResult(result: RunnerResult): Promise<boolean> {
  const [stdout, stderr] = await Promise.all([
    readArtifactText(path.join(result.artifactDir, "stdout.log")),
    readArtifactText(path.join(result.artifactDir, "stderr.log")),
  ]);
  const combinedError = result.error?.message ?? "";

  return matchesOpenCodeModelRejected(stdout, stderr)
    || matchesCodexModelRejected(stdout)
    || matchesClaudeCodeModelRejected(stdout)
    || matchesCursorAgentModelRejected(stderr)
    || matchesGenericModelRejected(combinedError);
}

async function readArtifactText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function matchesOpenCodeModelRejected(stdout: string, stderr: string): boolean {
  return stdout.includes('"type":"error"') && stdout.includes("Model not found:")
    || stderr.includes("ProviderModelNotFoundError");
}

function matchesCodexModelRejected(stdout: string): boolean {
  return (stdout.includes('"type":"error"') || stdout.includes('"type":"turn.failed"'))
    && stdout.includes("invalid_request_error")
    && stdout.includes("model is not supported");
}

function matchesClaudeCodeModelRejected(stdout: string): boolean {
  return stdout.includes('"type":"result"')
    && stdout.includes('"is_error":true')
    && stdout.includes('"api_error_status":404')
    && stdout.includes('"modelUsage":{}')
    && stdout.includes('"error":"invalid_request"');
}

function matchesCursorAgentModelRejected(stderr: string): boolean {
  return stderr.includes("Cannot use this model:");
}

function matchesGenericModelRejected(message: string): boolean {
  return message.includes("Model not found:")
    || message.includes("Cannot use this model:")
    || message.includes("model is not supported");
}
