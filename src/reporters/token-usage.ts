import process from "node:process";
import type {
  FailureClass,
  RunnerResult,
  RunnerResultStatus,
  SuiteRunResult,
} from "../domain/result.js";
import type { UsageReport } from "../domain/session-report.js";
import type { BenchmarkReporter } from "./contract.js";

interface TokenUsageReporterOptions {
  stdout?: Pick<NodeJS.WriteStream, "write">;
}

interface TokenBillable {
  sum: number;
  avg: number;
}

type TokenUsageKind = "provider" | "derived" | "unavailable";

interface TokenUsageError {
  name: string;
  message: string;
}

interface TokenUsageRow {
  case: string;
  runner: string;
  passed: boolean;
  status: RunnerResultStatus;
  usage: TokenUsageKind;
  billable: TokenBillable | null;
  failureOrigin?: RunnerResult["failureOrigin"];
  failureClass?: FailureClass;
  error?: TokenUsageError;
}

interface TokenUsageSummary {
  passed: boolean;
  billable: TokenBillable | null;
  artifacts: string;
  rows: TokenUsageRow[];
}

export function createTokenUsageReporter(
  options: TokenUsageReporterOptions = {},
): BenchmarkReporter {
  const stdout = options.stdout ?? process.stdout;

  return {
    onSuiteFinish(event) {
      stdout.write(`${JSON.stringify(summarizeSuiteRun(event.result))}\n`);
    },
  };
}

function summarizeSuiteRun(result: SuiteRunResult): TokenUsageSummary {
  const rows = result.cases.flatMap((caseResult) =>
    caseResult.runnerResults.map((runnerResult) => summarizeRow(caseResult.caseId, runnerResult)),
  );
  const billableRows = rows.filter(
    (row): row is TokenUsageRow & { billable: TokenBillable } => row.billable !== null,
  );

  return {
    passed: result.cases.every((caseResult) => caseResult.passed),
    billable:
      billableRows.length === 0
        ? null
        : {
            sum: billableRows.reduce((sum, row) => sum + row.billable.sum, 0),
            avg: billableRows.reduce((sum, row) => sum + row.billable.avg, 0) / billableRows.length,
          },
    artifacts: result.suiteRunArtifactDir,
    rows,
  };
}

function summarizeRow(caseId: string, result: RunnerResult): TokenUsageRow {
  const usage = classifyUsage(result.report.usage);
  const passed = result.status === "passed";

  return {
    case: caseId,
    runner: result.runner.id,
    passed,
    status: result.status,
    usage,
    billable: passed && usage === "provider" ? createBillable(result) : null,
    ...(result.failureOrigin === undefined ? {} : { failureOrigin: result.failureOrigin }),
    ...(result.failureClass === undefined ? {} : { failureClass: result.failureClass }),
    ...(result.error === undefined
      ? {}
      : {
          error: {
            name: result.error.name,
            message: result.error.message,
          },
        }),
  };
}

function classifyUsage(usage: UsageReport): TokenUsageKind {
  if (usage.totalTokens === undefined) {
    return "unavailable";
  }

  if (usage.source.input === "provider" && usage.source.output === "provider") {
    return "provider";
  }

  return "derived";
}

function createBillable(result: RunnerResult): TokenBillable {
  const avg = result.report.usage.totalTokens;

  if (avg === undefined) {
    throw new Error(`Missing billable token usage for runner ${result.runner.id}.`);
  }

  const repetitions =
    result.repetitions === undefined ? 1 : Math.max(result.successfulRepetitions ?? 0, 1);

  return {
    sum: avg * repetitions,
    avg,
  };
}
