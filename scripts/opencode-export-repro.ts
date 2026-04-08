import process from "node:process";
import { execFileCapture } from "../src/utils/process.ts";

const DEFAULT_CWD = "/Users/szymon.chmal/Projects/rn-devtools/apps/playground";
const DEFAULT_PROMPT = "Connect to iPhone 17 Pro via Rozenite and pull MMKV storages.";
const DEFAULT_ITERATIONS = 10;

async function main(): Promise<void> {
  const cwd = process.env.REPRO_CWD?.trim() || DEFAULT_CWD;
  const prompt = process.env.REPRO_PROMPT?.trim() || DEFAULT_PROMPT;
  const iterations = parsePositiveInteger(process.env.REPRO_ITERATIONS) ?? DEFAULT_ITERATIONS;

  const attempts: AttemptResult[] = [];

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const attempt = await runAttempt({ cwd, prompt, iteration });
    attempts.push(attempt);

    const summary = {
      iteration,
      sessionId: attempt.sessionId,
      runStdoutLength: attempt.runStdoutLength,
      firstExportStdoutLength: attempt.firstExport.stdoutLength,
      firstExportValidJson: attempt.firstExport.validJson,
      secondExportStdoutLength: attempt.secondExport.stdoutLength,
      secondExportValidJson: attempt.secondExport.validJson,
      reproduced: attempt.reproduced,
    };

    process.stdout.write(`${JSON.stringify(summary)}\n`);

    if (attempt.reproduced) {
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            reason: "first export was partial but re-export succeeded",
            attempt,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: false,
        reason: `did not reproduce within ${String(iterations)} attempts`,
        attempts,
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
}

async function runAttempt(input: {
  cwd: string;
  prompt: string;
  iteration: number;
}): Promise<AttemptResult> {
  const runResult = await runCommand([
    "opencode",
    "run",
    "--format",
    "json",
    "--thinking",
    input.prompt,
  ], input.cwd);

  if (runResult.exitCode !== 0) {
    throw new Error(
      [
        `opencode run failed on attempt ${String(input.iteration)} with exit code ${String(runResult.exitCode)}`,
        runResult.stderr.trim(),
      ]
        .filter((value) => value.length > 0)
        .join("\n"),
    );
  }

  const sessionId = extractSessionId(runResult.stdout) ?? extractSessionId(runResult.stderr);
  if (sessionId === undefined) {
    throw new Error(`Could not extract session id from opencode run output on attempt ${String(input.iteration)}.`);
  }

  const firstExport = await inspectExport(input.cwd, sessionId);
  const secondExport = await inspectExport(input.cwd, sessionId);

  return {
    iteration: input.iteration,
    sessionId,
    runStdoutLength: runResult.stdout.length,
    runStderrLength: runResult.stderr.length,
    firstExport,
    secondExport,
    reproduced:
      !firstExport.validJson
      && firstExport.stdoutLength < secondExport.stdoutLength
      && secondExport.validJson,
  };
}

async function inspectExport(cwd: string, sessionId: string): Promise<ExportInspection> {
  const result = await runCommand(["opencode", "export", sessionId], cwd);
  const validation = validateExport(result.stdout);

  return {
    stdoutLength: result.stdout.length,
    stderrLength: result.stderr.length,
    exitCode: result.exitCode,
    validJson: validation.valid,
    messageCount: validation.messageCount,
    parseError: validation.parseError,
    stdoutTail: result.stdout.slice(-200),
    stderr: result.stderr,
  };
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

function validateExport(text: string): {
  valid: boolean;
  messageCount?: number;
  parseError?: string;
} {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      valid: false,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }

  if (!isRecord(parsed) || !isRecord(parsed.info) || !Array.isArray(parsed.messages)) {
    return {
      valid: false,
      parseError: "missing required session fields",
    };
  }

  return {
    valid: true,
    messageCount: parsed.messages.length,
  };
}

function extractSessionId(text: string): string | undefined {
  const match = text.match(/\b(ses_[A-Za-z0-9]+)\b/);
  return match?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

interface ExportInspection {
  stdoutLength: number;
  stderrLength: number;
  exitCode: number;
  validJson: boolean;
  messageCount?: number;
  parseError?: string;
  stdoutTail: string;
  stderr: string;
}

interface AttemptResult {
  iteration: number;
  sessionId: string;
  runStdoutLength: number;
  runStderrLength: number;
  firstExport: ExportInspection;
  secondExport: ExportInspection;
  reproduced: boolean;
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
