import process from "node:process";
import { execFileCapture } from "../src/utils/process.ts";

const DEFAULT_PROMPT = "hello world, say hello";

async function main(): Promise<void> {
  const prompt = process.argv.slice(2).join(" ").trim() || DEFAULT_PROMPT;
  const cwd = process.cwd();

  const runResult = await runCommand([
    "opencode",
    "run",
    "--format",
    "json",
    "--thinking",
    prompt,
  ], cwd);

  if (runResult.exitCode !== 0) {
    throw new Error(
      [
        `opencode run failed with exit code ${String(runResult.exitCode)}`,
        runResult.stderr.trim(),
      ]
        .filter((value) => value.length > 0)
        .join("\n"),
    );
  }

  const sessionId = extractSessionId(runResult.stdout) ?? extractSessionId(runResult.stderr);
  if (sessionId === undefined) {
    throw new Error("Could not extract session id from opencode run output.");
  }

  const exportResult = await runCommand(["opencode", "export", sessionId], cwd);
  if (exportResult.exitCode !== 0) {
    throw new Error(
      [
        `opencode export failed with exit code ${String(exportResult.exitCode)}`,
        exportResult.stderr.trim(),
      ]
        .filter((value) => value.length > 0)
        .join("\n"),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(exportResult.stdout);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Export stdout is not valid JSON: ${reason}`);
  }

  if (!isRecord(parsed) || !isRecord(parsed.info) || !Array.isArray(parsed.messages)) {
    throw new Error("Export JSON is missing required OpenCode session fields.");
  }

  const exportSessionId = typeof parsed.info.id === "string" ? parsed.info.id : undefined;
  if (exportSessionId !== sessionId) {
    throw new Error(
      `Export session id mismatch: run emitted ${sessionId}, export contained ${String(exportSessionId)}`,
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        prompt,
        sessionId,
        runStdoutLength: runResult.stdout.length,
        runStderrLength: runResult.stderr.length,
        exportStdoutLength: exportResult.stdout.length,
        exportStderrLength: exportResult.stderr.length,
        messageCount: parsed.messages.length,
      },
      null,
      2,
    )}\n`,
  );
}

async function runCommand(argv: string[], cwd: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const [command, ...args] = argv;
  if (command === undefined) {
    throw new Error("Missing command");
  }

  const { stdout, stderr, exitCode } = await execFileCapture(command, args, {
    cwd,
    timeoutMs: 120_000,
  });

  return { stdout, stderr, exitCode: exitCode ?? 1 };
}

function extractSessionId(text: string): string | undefined {
  const match = text.match(/\b(ses_[A-Za-z0-9]+)\b/);
  return match?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
