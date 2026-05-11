import type { RunnerInfo } from "./runner.js";
import type { SessionReport } from "./session-report.js";

interface BaseRunnerResult {
  runner: RunnerInfo;
  passed: boolean;
  status: RunnerResultStatus;
  durationMs: number;
  executionArtifactDir: string;
  artifactDir: string;
  report: SessionReport;
  error?: SerializedError;
  failureOrigin?: RunnerFailureOrigin;
  failureClass?: FailureClass;
  failureLogPath?: string;
}

export interface RunnerSessionResult extends BaseRunnerResult {
  session: number;
}

export interface RepetitionResult extends BaseRunnerResult {
  repetition: number;
  session?: number;
  sessions?: RunnerSessionResult[];
}

export interface RunnerResult extends BaseRunnerResult {
  session?: number;
  sessions?: RunnerSessionResult[];
  repeatTarget?: number;
  completedRepetitions?: number;
  successfulRepetitions?: number;
  stoppedAtRepetition?: number;
  repetitions?: RepetitionResult[];
}

export interface FailureClass {
  id: string;
  label?: string;
}

export type RunnerResultStatus = "passed" | "failed" | "expected-failed" | "unexpected-passed";

export interface CaseResult {
  caseId: string;
  tags: string[];
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
  suiteRunArtifactDir: string;
  declaredTags: string[];
  selectedTags: string[];
  cases: CaseResult[];
  runners: RunnerSummary[];
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export type RunnerFailureOrigin =
  | "assertion"
  | "assert-hook"
  | "max-steps"
  | "model-rejected"
  | "runner"
  | "workspace-bootstrap"
  | "workspace"
  | "collection"
  | "normalization"
  | "snapshot";
