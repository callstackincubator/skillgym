import type { AgentConfig, CodexAgentConfig, OpenCodeAgentConfig, RunnerInfo } from "./runner.ts";
import type { SessionReport } from "./session-report.ts";

export interface RunInput {
  runner: RunnerInfo;
  prompt: string;
  cwd: string;
  timeoutMs: number;
  artifactsDir: string;
  showRunnerOutput?: boolean;
}

export type RunnerAdapterConfig = AgentConfig;

export type { CodexAgentConfig, OpenCodeAgentConfig };

export interface RunHandle {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
}

export interface RawRunArtifacts {
  stdout: string;
  stderr: string;
  stdoutPath: string;
  stderrPath: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  sessionId?: string;
  sessionPath?: string;
  exportPath?: string;
  rawSession?: unknown;
}

export interface RunnerAdapter {
  run(input: RunInput): Promise<RunHandle>;
  collect(handle: RunHandle, input: RunInput): Promise<RawRunArtifacts>;
  normalize(input: RunInput, artifacts: RawRunArtifacts): Promise<SessionReport>;
}
