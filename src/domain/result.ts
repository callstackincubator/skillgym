import type { RunnerInfo } from "./runner.js";
import type { SessionReport } from "./session-report.js";

export interface RunnerResult {
  runner: RunnerInfo;
  passed: boolean;
  durationMs: number;
  artifactDir: string;
  report: SessionReport;
  error?: SerializedError;
  failureType?: RunnerFailureType;
}

export interface CaseResult {
  caseId: string;
  passed: boolean;
  runnerResults: RunnerResult[];
}

export interface RunnerSummary {
  runner: RunnerInfo;
  totalCases: number;
  passedCases: number;
  successRate: number;
  averageDurationMs: number;
  averageInputTokens?: number;
  averageOutputTokens?: number;
  averageReasoningTokens?: number;
  averageCacheTokens?: number;
  averageTotalTokens?: number;
}

export interface SuiteRunResult {
  suitePath: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  outputDir: string;
  cases: CaseResult[];
  runners: RunnerSummary[];
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export type RunnerFailureType = "assertion" | "runner-crash" | "timeout";
