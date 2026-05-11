import process from "node:process";
import type { CaseResult, FailureClass, RunnerResult, SuiteRunResult } from "../domain/result.js";
import type { BenchmarkReporter } from "./contract.js";

interface JsonSummaryReporterOptions {
  stdout?: Pick<NodeJS.WriteStream, "write">;
}

interface SummaryError {
  name: string;
  message: string;
}

interface SummaryRunnerResult {
  runner: RunnerResult["runner"];
  passed: boolean;
  status: RunnerResult["status"];
  session?: number;
  repeatTarget?: number;
  completedRepetitions?: number;
  successfulRepetitions?: number;
  stoppedAtRepetition?: number;
  retryCount: number;
  durationMs: number;
  executionArtifactDir: string;
  artifactDir: string;
  usage: RunnerResult["report"]["usage"];
  sessions?: SummarySessionResult[];
  repetitions?: SummaryRepetitionResult[];
  error?: SummaryError;
  failureOrigin?: RunnerResult["failureOrigin"];
  failureClass?: FailureClass;
}

interface SummaryRepetitionResult {
  repetition: number;
  passed: boolean;
  status: RunnerResult["status"];
  session?: number;
  retryCount: number;
  durationMs: number;
  executionArtifactDir: string;
  artifactDir: string;
  usage: RunnerResult["report"]["usage"];
  sessions?: SummarySessionResult[];
  error?: SummaryError;
  failureOrigin?: RunnerResult["failureOrigin"];
  failureClass?: FailureClass;
}

interface SummarySessionResult {
  passed: boolean;
  status: RunnerResult["status"];
  session: number;
  durationMs: number;
  executionArtifactDir: string;
  artifactDir: string;
  usage: RunnerResult["report"]["usage"];
  error?: SummaryError;
  failureOrigin?: RunnerResult["failureOrigin"];
  failureClass?: FailureClass;
}

interface SummaryCaseResult {
  caseId: string;
  tags: string[];
  passed: boolean;
  runnerResults: SummaryRunnerResult[];
}

interface SummarySuiteResult {
  suitePath: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  suiteRunArtifactDir: string;
  declaredTags: string[];
  selectedTags: string[];
  cases: SummaryCaseResult[];
  runners: SuiteRunResult["runners"];
}

function summarizeRunnerResult(result: RunnerResult): SummaryRunnerResult {
  const summary: SummaryRunnerResult = {
    runner: result.runner,
    passed: result.passed,
    status: result.status,
    session: result.session,
    repeatTarget: result.repeatTarget,
    completedRepetitions: result.completedRepetitions,
    successfulRepetitions: result.successfulRepetitions,
    stoppedAtRepetition: result.stoppedAtRepetition,
    retryCount: countRetries(result),
    durationMs: result.durationMs,
    executionArtifactDir: result.executionArtifactDir,
    artifactDir: result.artifactDir,
    usage: result.report.usage,
  };

  if (result.sessions !== undefined) {
    summary.sessions = result.sessions.map(summarizeSessionResult);
  }

  if (result.repetitions !== undefined) {
    summary.repetitions = result.repetitions.map(summarizeRepetitionResult);
  }

  if (result.error !== undefined) {
    summary.error = { name: result.error.name, message: result.error.message };
  }

  if (result.failureOrigin !== undefined) {
    summary.failureOrigin = result.failureOrigin;
  }

  if (result.failureClass !== undefined) {
    summary.failureClass = result.failureClass;
  }

  return summary;
}

function countRetries(result: RunnerResult): number {
  if (result.repetitions !== undefined) {
    return result.repetitions.reduce(
      (sum, repetition) => sum + Math.max(0, (repetition.sessions?.length ?? 1) - 1),
      0,
    );
  }

  return Math.max(0, (result.sessions?.length ?? 1) - 1);
}

function summarizeRepetitionResult(
  result: NonNullable<RunnerResult["repetitions"]>[number],
): SummaryRepetitionResult {
  const summary: SummaryRepetitionResult = {
    repetition: result.repetition,
    passed: result.passed,
    status: result.status,
    session: result.session,
    retryCount: Math.max(0, (result.sessions?.length ?? 1) - 1),
    durationMs: result.durationMs,
    executionArtifactDir: result.executionArtifactDir,
    artifactDir: result.artifactDir,
    usage: result.report.usage,
  };

  if (result.sessions !== undefined) {
    summary.sessions = result.sessions.map(summarizeSessionResult);
  }

  if (result.error !== undefined) {
    summary.error = { name: result.error.name, message: result.error.message };
  }

  if (result.failureOrigin !== undefined) {
    summary.failureOrigin = result.failureOrigin;
  }

  if (result.failureClass !== undefined) {
    summary.failureClass = result.failureClass;
  }

  return summary;
}

function summarizeSessionResult(
  result: NonNullable<RunnerResult["sessions"]>[number],
): SummarySessionResult {
  const summary: SummarySessionResult = {
    passed: result.passed,
    status: result.status,
    session: result.session,
    durationMs: result.durationMs,
    executionArtifactDir: result.executionArtifactDir,
    artifactDir: result.artifactDir,
    usage: result.report.usage,
  };

  if (result.error !== undefined) {
    summary.error = { name: result.error.name, message: result.error.message };
  }

  if (result.failureOrigin !== undefined) {
    summary.failureOrigin = result.failureOrigin;
  }

  if (result.failureClass !== undefined) {
    summary.failureClass = result.failureClass;
  }

  return summary;
}

function summarizeCaseResult(result: CaseResult): SummaryCaseResult {
  return {
    caseId: result.caseId,
    tags: result.tags,
    passed: result.passed,
    runnerResults: result.runnerResults.map(summarizeRunnerResult),
  };
}

function summarizeSuiteResult(result: SuiteRunResult): SummarySuiteResult {
  return {
    suitePath: result.suitePath,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    durationMs: result.durationMs,
    suiteRunArtifactDir: result.suiteRunArtifactDir,
    declaredTags: result.declaredTags,
    selectedTags: result.selectedTags,
    cases: result.cases.map(summarizeCaseResult),
    runners: result.runners,
  };
}

export function createJsonSummaryReporter(
  options: JsonSummaryReporterOptions = {},
): BenchmarkReporter {
  const stdout = options.stdout ?? process.stdout;

  return {
    onSuiteFinish(event) {
      stdout.write(`${JSON.stringify(summarizeSuiteResult(event.result), null, 2)}\n`);
    },
  };
}
