import { appendFile } from "node:fs/promises";
import process from "node:process";
import type { CaseResult, RunnerResult, RunnerSummary, SuiteRunResult } from "../domain/result.js";
import type { BenchmarkReporter } from "./contract.js";
import { formatDuration, formatTokens } from "./format.js";
import { extractUserStackFrame } from "./stack-frame.js";

const MAX_SUMMARY_FAILURES = 10;

interface GitHubActionsReporterOptions {
  stdout?: Pick<NodeJS.WriteStream, "write">;
  env?: NodeJS.ProcessEnv;
}

export function createGitHubActionsReporter(options: GitHubActionsReporterOptions = {}): BenchmarkReporter {
  const stdout = options.stdout ?? process.stdout;
  const env = options.env ?? process.env;

  return {
    async onSuiteFinish(event) {
      for (const failure of listFailures(event.result)) {
        stdout.write(`${formatAnnotationCommand(failure.caseId, failure.result)}\n`);
      }

      const summaryPath = env.GITHUB_STEP_SUMMARY;
      if (summaryPath === undefined || summaryPath.length === 0) {
        return;
      }

      await appendFile(summaryPath, `${formatJobSummary(event.result)}\n`, "utf8");
    },
  };
}

function formatAnnotationCommand(caseId: string, result: RunnerResult): string {
  const properties = new Map<string, string>([["title", `${caseId} > ${result.runner.id}`]]);
  const stackFrame = result.error === undefined ? undefined : extractUserStackFrame(result.error);

  if (stackFrame !== undefined) {
    properties.set("file", stackFrame.filePath);
    properties.set("line", stackFrame.line);
    properties.set("col", stackFrame.column);
  }

  return `::error${formatCommandProperties(properties)}::${escapeCommandMessage(formatAnnotationMessage(result))}`;
}

function formatAnnotationMessage(result: RunnerResult): string {
  const lines = [`failure type: ${result.failureType ?? "unknown"}`];

  if (result.failureOrigin !== undefined) {
    lines.push(`failure origin: ${result.failureOrigin}`);
  }

  if (result.error !== undefined) {
    lines.push(`error: ${result.error.name}: ${result.error.message}`);
  }

  lines.push(`artifacts: ${result.artifactDir}`);

  if (result.failureLogPath !== undefined) {
    lines.push(`log: ${result.failureLogPath}`);
  }

  return lines.join("\n");
}

function formatCommandProperties(properties: Map<string, string>): string {
  if (properties.size === 0) {
    return "";
  }

  return ` ${Array.from(properties.entries()).map(([key, value]) => `${key}=${escapeCommandProperty(value)}`).join(",")}`;
}

function escapeCommandProperty(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");
}

function escapeCommandMessage(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

function formatJobSummary(result: SuiteRunResult): string {
  const passedCases = countPassedCases(result.cases);
  const passedRuns = countPassedRuns(result.cases);
  const totalRuns = countTotalRuns(result.cases);
  const failures = listFailures(result);
  const lines = [
    "## SkillGym Summary",
    "",
    `- Suite: \`${result.suitePath}\``,
    `- Cases: ${passedCases} passed, ${result.cases.length - passedCases} failed`,
    `- Runs: ${passedRuns} passed, ${totalRuns - passedRuns} failed`,
    `- Duration: ${formatDuration(result.durationMs)}`,
    `- Output: \`${result.outputDir}\``,
    ...(result.selectedTags.length > 0 ? [`- Tags: ${result.selectedTags.map((t) => `\`${t}\``).join(", ")}`] : []),
  ];

  for (const summary of result.runners) {
    lines.push("", `### Runner: \`${summary.runner.id}\` ${formatRunnerAgentLabel(summary.runner)}`);
    lines.push("");
    lines.push("| Case | Duration | Input | Output | Reasoning | Cache | Billable |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const { caseId, runnerResult } of getRunnerCases(result, summary.runner.id)) {
      lines.push(formatRunnerCaseRow(caseId, runnerResult));
    }
  }

  if (failures.length > 0) {
    lines.push("", "### Failures");
    for (const failure of failures.slice(0, MAX_SUMMARY_FAILURES)) {
      lines.push(`- ${formatFailureSummaryItem(failure.caseId, failure.result)}`);
    }

    if (failures.length > MAX_SUMMARY_FAILURES) {
      lines.push(`- ...and ${failures.length - MAX_SUMMARY_FAILURES} more failures`);
    }
  }

  return lines.join("\n");
}

function formatRunnerAgentLabel(runner: RunnerSummary["runner"]): string {
  const model = runner.agent.model === undefined ? "" : `, ${runner.agent.model}`;
  return `(${runner.agent.type}${model})`;
}

function formatRunnerCaseRow(caseId: string, result: RunnerResult): string {
  const status = result.passed ? "✅" : "❌";
  const usage = result.report.usage;
  return `| ${status} \`${caseId}\` | ${formatDuration(result.durationMs)} | ${formatTokens(usage.inputTokens)} | ${formatTokens(usage.outputTokens)} | ${formatTokens(usage.reasoningTokens)} | ${formatTokens(usage.cacheTokens)} | ${formatTokens(usage.totalTokens)} |`;
}

function getRunnerCases(
  result: SuiteRunResult,
  runnerId: string,
): Array<{ caseId: string; runnerResult: RunnerResult }> {
  return result.cases.flatMap((caseResult) => {
    const runnerResult = caseResult.runnerResults.find((entry) => entry.runner.id === runnerId);
    return runnerResult === undefined ? [] : [{ caseId: caseResult.caseId, runnerResult }];
  });
}

function formatFailureSummaryItem(caseId: string, result: RunnerResult): string {
  const segments = [
    `\`${caseId} > ${result.runner.id}\``,
    `${result.failureType ?? "unknown"}`,
    `artifacts: \`${result.artifactDir}\``,
  ];

  if (result.failureLogPath !== undefined) {
    segments.push(`log: \`${result.failureLogPath}\``);
  }

  if (result.error !== undefined) {
    segments.splice(2, 0, `${result.error.name}: ${result.error.message}`);
  }

  return segments.join("; ");
}

function listFailures(result: SuiteRunResult): Array<{ caseId: string; result: RunnerResult }> {
  const failures: Array<{ caseId: string; result: RunnerResult }> = [];

  for (const caseResult of result.cases) {
    for (const runnerResult of caseResult.runnerResults) {
      if (!runnerResult.passed) {
        failures.push({ caseId: caseResult.caseId, result: runnerResult });
      }
    }
  }

  return failures;
}

function countPassedCases(cases: CaseResult[]): number {
  return cases.filter((caseResult) => caseResult.passed).length;
}

function countPassedRuns(cases: CaseResult[]): number {
  return cases.reduce((sum, caseResult) => sum + caseResult.runnerResults.filter((result) => result.passed).length, 0);
}

function countTotalRuns(cases: CaseResult[]): number {
  return cases.reduce((sum, caseResult) => sum + caseResult.runnerResults.length, 0);
}
