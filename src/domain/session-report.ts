import type { RunnerInfo } from "./runner.ts";

export type UsageSource = "provider" | "derived" | "chars";

export interface SessionReport {
  runner: RunnerInfo;
  sessionId?: string;
  prompt: string;
  usage: UsageReport;
  files: SessionFiles;
  detectedSkills: SkillDetection[];
  events: SessionEvent[];
  finalOutput: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  rawArtifacts: RawArtifactPaths;
}

export interface UsageReport {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  completionTokens?: number;
  inputChars: number;
  outputChars: number;
  reasoningChars: number;
  source: {
    input: UsageSource;
    output: UsageSource;
    reasoning: UsageSource;
  };
}

export interface SessionFiles {
  /** Canonical absolute paths resolved against the best available working directory. */
  observedReads: string[];
  observedSkillReads: string[];
}

export interface SkillDetection {
  skill: string;
  confidence: "explicit" | "strong" | "medium" | "weak";
  evidence: string[];
}

export interface RawArtifactPaths {
  stdoutPath?: string;
  stderrPath?: string;
  sessionPath?: string;
  exportPath?: string;
}

export type SessionEvent =
  | MessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | CommandEvent
  | FileReadEvent
  | SkillSignalEvent;

export interface MessageEvent {
  type: "message";
  role: "user" | "assistant";
  phase?: "thinking" | "commentary" | "final";
  text: string;
  at?: string;
}

export interface ToolCallEvent {
  type: "toolCall";
  tool: string;
  args?: unknown;
  at?: string;
}

export interface ToolResultEvent {
  type: "toolResult";
  tool?: string;
  output: string;
  at?: string;
}

export interface CommandEvent {
  type: "command";
  command: string;
  at?: string;
}

export interface FileReadEvent {
  type: "fileRead";
  /** Canonical absolute path resolved against the best available working directory. */
  path: string;
  at?: string;
}

export interface SkillSignalEvent {
  type: "skillSignal";
  skill: string;
  signal: string;
  at?: string;
}
