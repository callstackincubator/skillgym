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
  durationMs: number;
  artifactDir: string;
  usage: RunnerResult["report"]["usage"];
  error?: SummaryError;
  failureType?: RunnerResult["failureType"];
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
  outputDir: string;
  declaredTags: string[];
  selectedTags: string[];
  cases: SummaryCaseResult[];
  runners: SuiteRunResult["runners"];
}

function summarizeRunnerResult(result: RunnerResult): SummaryRunnerResult {
  const summary: SummaryRunnerResult = {
    runner: result.runner,
    passed: result.passed,
    durationMs: result.durationMs,
    artifactDir: result.artifactDir,
    usage: result.report.usage,
  };

  if (result.error !== undefined) {
    summary.error = { name: result.error.name, message: result.error.message };
  }

  if (result.failureType !== undefined) {
    summary.failureType = result.failureType;
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
    outputDir: result.outputDir,
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
