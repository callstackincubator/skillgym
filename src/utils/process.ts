import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import nanoSpawn, { SubprocessError } from "nano-spawn";
import type { Options, Subprocess } from "nano-spawn";
import type { AgentType } from "../domain/runner.js";
import { MaxStepsExceededError, createMaxStepsMonitor } from "../limits/max-steps.js";

function spawn(command: string, args: string[], options: Options): Subprocess {
  const subprocess = nanoSpawn(command, args, options);

  void subprocess.nodeChildProcess.then((child) => {
    const terminate = async (signal: NodeJS.Signals): Promise<void> => {
      try {
        child.kill(signal);
      } catch {
        // child already exited
      }
      process.off("SIGINT", sigintHandler);
      process.off("SIGTERM", sigtermHandler);
      process.kill(process.pid, signal);
    };

    const sigintHandler = () => void terminate("SIGINT");
    const sigtermHandler = () => void terminate("SIGTERM");

    process.on("SIGINT", sigintHandler);
    process.on("SIGTERM", sigtermHandler);

    void subprocess.finally(() => {
      process.off("SIGINT", sigintHandler);
      process.off("SIGTERM", sigtermHandler);
    });
  });

  return subprocess;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  terminatedByMonitor?: MaxStepsExceededError;
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

export function isMaxStepsExceededError(error: unknown): error is MaxStepsExceededError {
  return error instanceof MaxStepsExceededError;
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
    maxSteps?: {
      limit: number;
      agentType: AgentType;
      runnerId: string;
    };
  },
): Promise<ExecResult> {
  if (
    options.mirror?.stdout !== undefined
    || options.mirror?.stderr !== undefined
    || options.maxSteps !== undefined
  ) {
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
    maxSteps?: {
      limit: number;
      agentType: AgentType;
      runnerId: string;
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
  let terminatedByMonitor: MaxStepsExceededError | undefined;
  const stdoutDecoder = new StringDecoder("utf8");
  const stderrDecoder = new StringDecoder("utf8");
  const maxStepsMonitor = options.maxSteps === undefined
    ? undefined
    : createMaxStepsMonitor({
        agentType: options.maxSteps.agentType,
        runnerId: options.maxSteps.runnerId,
        maxSteps: options.maxSteps.limit,
      });
  let stdoutLineBuffer = "";

  child.stdout?.on("data", (chunk: string | Buffer) => {
    const text = typeof chunk === "string" ? chunk : stdoutDecoder.write(chunk);
    stdout += text;
    options.mirror?.stdout?.write(text);

    if (maxStepsMonitor === undefined || terminatedByMonitor !== undefined) {
      return;
    }

    stdoutLineBuffer += text;
    const result = consumeJsonLines(stdoutLineBuffer, (line) => maxStepsMonitor.observeLine(line));
    stdoutLineBuffer = result.remainder;

    if (result.value !== undefined) {
      terminatedByMonitor = new MaxStepsExceededError(result.value);
      child.kill("SIGKILL");
    }
  });

  child.stderr?.on("data", (chunk: string | Buffer) => {
    const text = typeof chunk === "string" ? chunk : stderrDecoder.write(chunk);
    stderr += text;
    options.mirror?.stderr?.write(text);
  });

  const stdoutEnded = waitForStreamEnd(child.stdout);
  const stderrEnded = waitForStreamEnd(child.stderr);

  try {
    await subprocess;
    await Promise.all([stdoutEnded, stderrEnded]);
    const finalized = finalizeBufferedOutput({
      stdout,
      stderr,
      stdoutDecoder,
      stderrDecoder,
      stdoutLineBuffer,
      maxStepsMonitor,
      terminatedByMonitor,
      mirror: options.mirror,
    });

    return {
      stdout: finalized.stdout,
      stderr: finalized.stderr,
      exitCode: 0,
      signal: null,
      timedOut: false,
      terminatedByMonitor: finalized.terminatedByMonitor,
    };
  } catch (error) {
    await Promise.allSettled([stdoutEnded, stderrEnded]);
    const finalized = finalizeBufferedOutput({
      stdout,
      stderr,
      stdoutDecoder,
      stderrDecoder,
      stdoutLineBuffer,
      maxStepsMonitor,
      terminatedByMonitor,
      mirror: options.mirror,
    });

    if (error instanceof SubprocessError) {
      return {
        stdout: finalized.stdout,
        stderr: finalized.stderr,
        exitCode: error.exitCode ?? null,
        signal: (error.signalName as NodeJS.Signals | undefined) ?? null,
        timedOut: finalized.terminatedByMonitor === undefined && isTimedOutSubprocessError(error),
        terminatedByMonitor: finalized.terminatedByMonitor,
      };
    }

    throw error;
  }
}

function finalizeBufferedOutput(options: {
  stdout: string;
  stderr: string;
  stdoutDecoder: StringDecoder;
  stderrDecoder: StringDecoder;
  stdoutLineBuffer: string;
  maxStepsMonitor?: ReturnType<typeof createMaxStepsMonitor>;
  terminatedByMonitor?: MaxStepsExceededError;
  mirror?: {
    stdout?: { write(chunk: string): unknown };
    stderr?: { write(chunk: string): unknown };
  };
}): { stdout: string; stderr: string; terminatedByMonitor?: MaxStepsExceededError } {
  let stdout = options.stdout;
  let stderr = options.stderr;
  let terminatedByMonitor = options.terminatedByMonitor;
  let stdoutLineBuffer = options.stdoutLineBuffer;

  const pendingStdout = options.stdoutDecoder.end();
  if (pendingStdout.length > 0) {
    stdout += pendingStdout;
    stdoutLineBuffer += pendingStdout;
    options.mirror?.stdout?.write(pendingStdout);
  }

  if (options.maxStepsMonitor !== undefined && terminatedByMonitor === undefined) {
    const result = consumeJsonLines(stdoutLineBuffer, (line) => options.maxStepsMonitor?.observeLine(line));
    stdoutLineBuffer = result.remainder;
    if (result.value !== undefined) {
      terminatedByMonitor = new MaxStepsExceededError(result.value);
    } else if (stdoutLineBuffer.trim().length > 0) {
      const finalState = options.maxStepsMonitor.observeLine(stdoutLineBuffer);
      if (finalState !== undefined) {
        terminatedByMonitor = new MaxStepsExceededError(finalState);
      }
    }
  }

  const pendingStderr = options.stderrDecoder.end();
  if (pendingStderr.length > 0) {
    stderr += pendingStderr;
    options.mirror?.stderr?.write(pendingStderr);
  }

  return { stdout, stderr, terminatedByMonitor };
}

function consumeJsonLines<T>(
  input: string,
  onLine: (line: string) => T | undefined,
): { remainder: string; value?: T } {
  let remainder = input;

  while (true) {
    const newlineIndex = remainder.indexOf("\n");
    if (newlineIndex === -1) {
      return { remainder };
    }

    const line = remainder.slice(0, newlineIndex);
    remainder = remainder.slice(newlineIndex + 1);
    const value = onLine(line);
    if (value !== undefined) {
      return { remainder, value };
    }
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
