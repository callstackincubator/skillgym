import type { CaseResult, RunnerResult, SuiteRunResult } from "../domain/result.js";
import type { RunnerInfo } from "../domain/runner.js";
import type { ScheduleMode } from "../domain/schedule.js";
import type { TestCase } from "../domain/test-case.js";

export interface ReporterContext {
  isInteractive: boolean;
  cwd: string;
  workspaceMode: "shared" | "isolated";
  suitePath: string;
  outputDir: string;
  selectedCaseCount: number;
  selectedRunnerCount: number;
  selectedExecutionCount: number;
  scheduleMode: ScheduleMode;
  maxParallel: number;
  caseFilter?: string;
  runnerFilter?: string;
  tagFilter?: string[];
  declaredTags: string[];
}

export interface SuiteStartEvent {
  context: ReporterContext;
  cases: TestCase[];
  runners: RunnerInfo[];
  startedAt: string;
}

export interface CaseStartEvent {
  context: ReporterContext;
  testCase: TestCase;
  caseIndex: number;
  totalCases: number;
}

export interface RunnerStartEvent {
  context: ReporterContext;
  testCase: TestCase;
  runner: RunnerInfo;
  caseIndex: number;
  totalCases: number;
}

export interface RunnerFinishEvent {
  context: ReporterContext;
  testCase: TestCase;
  runner: RunnerInfo;
  result: RunnerResult;
  caseIndex: number;
  totalCases: number;
}

export interface CaseFinishEvent {
  context: ReporterContext;
  testCase: TestCase;
  result: CaseResult;
  caseIndex: number;
  totalCases: number;
}

export interface SuiteFinishEvent {
  context: ReporterContext;
  result: SuiteRunResult;
}

export interface SuiteErrorEvent {
  context?: Partial<ReporterContext>;
  error: unknown;
}

export interface BenchmarkReporter {
  onSuiteStart?(event: SuiteStartEvent): void | Promise<void>;
  onCaseStart?(event: CaseStartEvent): void | Promise<void>;
  onRunnerStart?(event: RunnerStartEvent): void | Promise<void>;
  onRunnerFinish?(event: RunnerFinishEvent): void | Promise<void>;
  onCaseFinish?(event: CaseFinishEvent): void | Promise<void>;
  onSuiteFinish?(event: SuiteFinishEvent): void | Promise<void>;
  onError?(event: SuiteErrorEvent): void | Promise<void>;
}
