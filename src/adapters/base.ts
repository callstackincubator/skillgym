import path from "node:path";
import type { RawRunArtifacts, RunHandle, RunInput } from "../domain/adapter.ts";
import { nowIso } from "../utils/time.ts";
import { CommandTimeoutError, execFileCapture } from "../utils/process.ts";
import { writeText } from "../utils/fs.ts";

export abstract class BaseAdapter {
  protected async runCommand(
    command: string,
    args: string[],
    input: RunInput,
    options: {
      env?: Record<string, string>;
    } = {},
  ): Promise<RunHandle & { stdout: string; stderr: string }> {
    const startedAt = nowIso();
    const startMs = Date.now();
    const result = await execFileCapture(command, args, {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      mirror: input.showRunnerOutput
        ? {
            stdout: process.stdout,
            stderr: process.stderr,
          }
        : undefined,
    });
    const endedAt = nowIso();
    const durationMs = Date.now() - startMs;

    const stdoutPath = path.join(input.artifactsDir, "stdout.log");
    const stderrPath = path.join(input.artifactsDir, "stderr.log");

    await writeText(stdoutPath, result.stdout);
    await writeText(stderrPath, result.stderr);

    if (result.timedOut) {
      throw new CommandTimeoutError(command, args, input.timeoutMs);
    }

    if (result.exitCode !== 0) {
      throw new Error(
        `Command failed: ${command} ${args.join(" ")} (exit ${String(result.exitCode)})`,
      );
    }

    return {
      startedAt,
      endedAt,
      durationMs,
      stdoutPath,
      stderrPath,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  protected toRawArtifacts(
    handle: RunHandle & { stdout: string; stderr: string },
    extra: Partial<RawRunArtifacts> = {},
  ): RawRunArtifacts {
    return {
      stdout: handle.stdout,
      stderr: handle.stderr,
      stdoutPath: handle.stdoutPath,
      stderrPath: handle.stderrPath,
      startedAt: handle.startedAt,
      endedAt: handle.endedAt,
      durationMs: handle.durationMs,
      ...extra,
    };
  }
}
