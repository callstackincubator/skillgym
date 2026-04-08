import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import spawn, { SubprocessError } from "nano-spawn";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

export class CommandTimeoutError extends Error {
  constructor(command: string, args: string[], timeoutMs: number) {
    super(`Command timed out after ${String(timeoutMs)}ms: ${command} ${args.join(" ")}`);
    this.name = "CommandTimeoutError";
  }
}

export function isCommandTimeoutError(error: unknown): error is CommandTimeoutError {
  return error instanceof CommandTimeoutError;
}

export async function execFileCapture(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    env?: NodeJS.ProcessEnv;
    mirror?: {
      stdout?: { write(chunk: string): unknown };
      stderr?: { write(chunk: string): unknown };
    };
  },
): Promise<ExecResult> {
  if (options.mirror?.stdout !== undefined || options.mirror?.stderr !== undefined) {
    return execFileCaptureWithMirror(command, args, options);
  }

  return execFileCaptureToFiles(command, args, options);
}

async function execFileCaptureToFiles(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    env?: NodeJS.ProcessEnv;
  },
): Promise<ExecResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-process-"));
  const stdoutPath = path.join(tempDir, "stdout.log");
  const stderrPath = path.join(tempDir, "stderr.log");
  const stdoutFile = await open(stdoutPath, "w");
  const stderrFile = await open(stderrPath, "w");
  let filesClosed = false;

  const closeFiles = async (): Promise<void> => {
    if (filesClosed) {
      return;
    }

    filesClosed = true;
    await Promise.all([stdoutFile.close(), stderrFile.close()]);
  };

  try {
    let subprocessError: unknown;

    try {
      await spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdin: "ignore",
        stdout: stdoutFile.fd,
        stderr: stderrFile.fd,
        timeout: options.timeoutMs,
        killSignal: "SIGKILL",
      });
    } catch (error) {
      subprocessError = error;
    }

    await closeFiles();

    const [stdout, stderr] = await Promise.all([
      readFile(stdoutPath, "utf8"),
      readFile(stderrPath, "utf8"),
    ]);

    if (subprocessError instanceof SubprocessError) {
      return {
        stdout,
        stderr,
        exitCode: subprocessError.exitCode ?? null,
        signal: (subprocessError.signalName as NodeJS.Signals | undefined) ?? null,
        timedOut: isTimedOutSubprocessError(subprocessError),
      };
    }

    if (subprocessError !== undefined) {
      throw subprocessError;
    }

    return {
      stdout,
      stderr,
      exitCode: 0,
      signal: null,
      timedOut: false,
    };
  } finally {
    await Promise.allSettled([closeFiles(), rm(tempDir, { recursive: true, force: true })]);
  }
}

async function execFileCaptureWithMirror(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    env?: NodeJS.ProcessEnv;
    mirror?: {
      stdout?: { write(chunk: string): unknown };
      stderr?: { write(chunk: string): unknown };
    };
  },
): Promise<ExecResult> {
  const subprocess = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: options.timeoutMs,
    killSignal: "SIGKILL",
  });
  const child = await subprocess.nodeChildProcess;

  let stdout = "";
  let stderr = "";

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");

  child.stdout?.on("data", (chunk: string | Buffer) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    stdout += text;
    options.mirror?.stdout?.write(text);
  });

  child.stderr?.on("data", (chunk: string | Buffer) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    stderr += text;
    options.mirror?.stderr?.write(text);
  });

  const stdoutEnded = waitForStreamEnd(child.stdout);
  const stderrEnded = waitForStreamEnd(child.stderr);

  try {
    await subprocess;
    await Promise.all([stdoutEnded, stderrEnded]);

    return {
      stdout,
      stderr,
      exitCode: 0,
      signal: null,
      timedOut: false,
    };
  } catch (error) {
    await Promise.allSettled([stdoutEnded, stderrEnded]);

    if (error instanceof SubprocessError) {
      return {
        stdout,
        stderr,
        exitCode: error.exitCode ?? null,
        signal: (error.signalName as NodeJS.Signals | undefined) ?? null,
        timedOut: isTimedOutSubprocessError(error),
      };
    }

    throw error;
  }
}

function isTimedOutSubprocessError(error: SubprocessError): boolean {
  return error.signalName === "SIGKILL" && error.exitCode === undefined;
}

async function waitForStreamEnd(
  stream: NodeJS.ReadableStream | null | undefined,
): Promise<void> {
  if (stream === null || stream === undefined) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    stream.once("end", resolve);
    stream.once("close", resolve);
    stream.once("error", reject);
  });
}
