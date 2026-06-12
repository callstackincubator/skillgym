import type {
  AgentConfig,
  ClaudeCodeAgentConfig,
  CodexAgentConfig,
  CopilotAgentConfig,
  CursorAgentConfig,
  OpenCodeAgentConfig,
  RunnerInfo,
} from "./runner.js";
import type { ExplainQuestionArtifact } from "./explain.js";
import type { SessionReport } from "./session-report.js";

export interface RunInput {
  runner: RunnerInfo;
  prompt: string;
  cwd: string;
  timeoutMs: number;
  maxSteps?: number;
  artifactsDir: string;
  showRunnerOutput?: boolean;
}

export type RunnerAdapterConfig = AgentConfig;

export type {
  ClaudeCodeAgentConfig,
  CodexAgentConfig,
  CopilotAgentConfig,
  CursorAgentConfig,
  OpenCodeAgentConfig,
};

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
  telemetryPath?: string;
  rawSession?: unknown;
}

export interface ExplainInput {
  runner: RunnerInfo;
  cwd: string;
  timeoutMs: number;
  artifactDir: string;
  sessionId: string;
  questions: readonly ExplainQuestionArtifact[];
  showRunnerOutput?: boolean;
}

export interface ExplainQuestionResult {
  question: ExplainQuestionArtifact;
  answer: string;
  sessionId?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  rawArtifacts: SessionReport["rawArtifacts"];
}

export interface ExplainResult {
  answers: ExplainQuestionResult[];
}

export interface RunnerAdapter {
  run(input: RunInput): Promise<RunHandle>;
  collect(handle: RunHandle, input: RunInput): Promise<RawRunArtifacts>;
  normalize(input: RunInput, artifacts: RawRunArtifacts): Promise<SessionReport>;
  explain(input: ExplainInput): Promise<ExplainResult>;
}
