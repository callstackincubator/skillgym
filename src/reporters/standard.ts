import path from "node:path";
import process from "node:process";
import cliSpinners from "cli-spinners";
import { printBanner } from "../cli/branding.js";
import pc from "picocolors";
import type {
  CaseResult,
  FailureClass,
  RunnerFailureOrigin,
  RunnerFailureType,
  RunnerResult,
  SerializedError,
  SuiteRunResult,
} from "../domain/result.js";
import type { RunnerInfo } from "../domain/runner.js";
import type { BenchmarkReporter, RunnerStartEvent, SuiteStartEvent } from "./contract.js";
import {
  formatDuration,
  formatPercent,
  formatRate,
  formatTokens,
  getSymbols,
  padCell,
  visibleWidth,
} from "./format.js";
import { extractUserStackFrame, formatStackFrameLocation } from "./stack-frame.js";

interface FailureEntry {
  caseId: string;
  runner: RunnerInfo;
  artifactDir: string;
  error?: SerializedError;
  failureType?: RunnerFailureType;
  failureOrigin?: RunnerFailureOrigin;
  failureClass?: FailureClass;
  failureLogPath?: string;
  status: RunnerResult["status"];
}

interface FailureGroup {
  failureClass: FailureClass;
  failures: FailureEntry[];
}

interface StandardReporterOptions {
  stdout?: Pick<NodeJS.WriteStream, "write" | "isTTY" | "columns">;
  isInteractive?: boolean;
  isUnicode?: boolean;
}

type InteractiveRunStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "expected-failed"
  | "unexpected-passed";

interface InteractiveRunEntry {
  key: string;
  caseId: string;
  runner: RunnerInfo;
  status: InteractiveRunStatus;
}

interface InteractiveState {
  entries: InteractiveRunEntry[];
  entryIndexByKey: Map<string, number>;
  renderedLineCount: number;
  spinnerFrameIndex: number;
  timer?: ReturnType<typeof setInterval>;
}

interface ReporterSymbols {
  pass: string;
  fail: string;
  bullet: string;
  warning: string;
}

const ACCENT_OPEN = "\x1b[38;5;141m";
const ACCENT_CLOSE = "\x1b[0m";
const RUNNER_CASE_WIDTH = 24;
const RUNNER_TIME_WIDTH = 12;
const SUMMARY_LABEL_WIDTH = 11;

export function createStandardReporter(options: StandardReporterOptions = {}): BenchmarkReporter {
  const stdout = options.stdout ?? process.stdout;
  const interactive = options.isInteractive ?? Boolean(stdout.isTTY);
  const unicode = options.isUnicode ?? process.platform !== "win32";
  const colors = pc.createColors(Boolean(stdout.isTTY));
  const accent = (value: string): string =>
    colors.isColorSupported ? `${ACCENT_OPEN}${value}${ACCENT_CLOSE}` : value;
  const symbols: ReporterSymbols = getSymbols(unicode);
  const spinner = unicode ? cliSpinners.dots : cliSpinners.line;
  const failures: FailureEntry[] = [];
  let interactiveState: InteractiveState | undefined;

  return {
    onSuiteStart(event) {
      printBanner({ kind: "compact", stdout });
      writeLine(`${colors.dim("Suite     ")}${accent(event.context.suitePath)}`, stdout);
      writeLine(
        `${colors.dim("Workspace ")}${colors.bold(event.context.workspaceMode === "shared" ? event.context.cwd : `${event.context.workspaceMode} per run`)}`,
        stdout,
      );
      writeLine(`${colors.dim("Output    ")}${colors.bold(event.context.outputDir)}`, stdout);
      writeLine(`${colors.dim("Cases     ")}${String(event.context.selectedCaseCount)}`, stdout);
      if (event.context.tagFilter !== undefined) {
        writeLine(`${colors.dim("Tags      ")}${event.context.tagFilter.join(", ")}`, stdout);
      }
      writeLine(`${colors.dim("Runners   ")}${String(event.context.selectedRunnerCount)}`, stdout);
      writeLine(
        `${colors.dim("Runs      ")}${String(event.context.selectedExecutionCount)}`,
        stdout,
      );
      writeLine(`${colors.dim("Parallel  ")}${String(event.context.maxParallel)}`, stdout);

      if (
        event.context.scheduleMode !== "serial" &&
        event.context.maxParallel > 1 &&
        event.context.workspaceMode === "shared"
      ) {
        writeLine(
          colors.yellow(
            `${symbols.warning} Concurrent schedule: ${event.context.scheduleMode} runs may overlap in the same workspace.`,
          ),
          stdout,
        );
      }

      writeLine("", stdout);

      if (!interactive) {
        return;
      }

      interactiveState = createInteractiveState(event);
      renderInteractiveRunList(interactiveState, stdout, colors, symbols, spinner.frames);
    },
    onRunnerStart(event) {
      if (!interactive) {
        return;
      }

      if (interactiveState === undefined) {
        return;
      }

      const key = createRunKey(event.testCase.id, event.runner.id);
      setInteractiveRunStatus(interactiveState, key, "running");
      interactiveState.spinnerFrameIndex = 0;
      renderInteractiveRunList(interactiveState, stdout, colors, symbols, spinner.frames);
      startSpinner(interactiveState, stdout, colors, symbols, spinner.frames, spinner.interval);
    },
    onRunnerFinish(event) {
      if (interactive && interactiveState !== undefined) {
        setInteractiveRunStatus(
          interactiveState,
          createRunKey(event.testCase.id, event.runner.id),
          event.result.status,
        );
        if (!hasRunningEntries(interactiveState)) {
          stopSpinner(interactiveState);
        }
        renderInteractiveRunList(interactiveState, stdout, colors, symbols, spinner.frames);
      }

      if (!event.result.passed) {
        failures.push({
          caseId: event.testCase.id,
          runner: event.result.runner,
          artifactDir: event.result.artifactDir,
          error: event.result.error,
          failureType: event.result.failureType,
          failureOrigin: event.result.failureOrigin,
          failureClass: event.result.failureClass,
          failureLogPath: event.result.failureLogPath,
          status: event.result.status,
        });
      }
    },
    onCaseFinish(event) {
      if (interactive) {
        return;
      }

      writeLine(formatCaseRow(event.result, symbols), stdout);
    },
    onSuiteFinish(event) {
      if (interactiveState !== undefined) {
        stopSpinner(interactiveState);
        renderInteractiveRunList(interactiveState, stdout, colors, symbols, spinner.frames);
        interactiveState = undefined;
      }

      writeLine("", stdout);
      for (const summary of event.result.runners) {
        writeLine(formatRunnerHeading(summary.runner), stdout);
        writeLine(formatRunnerLegend(colors), stdout);
        for (const caseResult of getRunnerCases(event.result, summary.runner.id)) {
          writeLine(
            formatRunnerCaseRow(caseResult.caseId, caseResult.runnerResult, symbols, accent),
            stdout,
          );
        }
        writeLine("", stdout);
      }

      if (failures.length > 0) {
        writeLine("", stdout);
        writeLine(colors.bold("Failure Classes"), stdout);
        writeLine("", stdout);

        for (const group of groupFailures(failures)) {
          writeLine(formatFailureGroup(group, colors), stdout);
          writeLine("", stdout);
        }

        writeLine("", stdout);
        writeLine(colors.bold("Failures"), stdout);
        writeLine("", stdout);

        for (const failure of failures) {
          writeLine(formatFailureBlock(failure, colors, symbols), stdout);
          writeLine("", stdout);
        }
      }

      writeLine(colors.bold("Summary"), stdout);
      writeLine("", stdout);
      writeLine(
        formatSummaryCountLine(
          "Cases",
          countPassedCases(event.result.cases),
          event.result.cases.length,
          colors,
        ),
        stdout,
      );
      writeLine(
        formatSummaryCountLine(
          "Runs",
          countPassedRuns(event.result.cases),
          countTotalRuns(event.result.cases),
          colors,
        ),
        stdout,
      );
      writeLine(formatSummaryStatusLine(event.result.cases, colors), stdout);
      writeLine(
        formatSummaryDetailLine("Duration", formatDuration(event.result.durationMs), colors),
        stdout,
      );
      writeLine(
        formatSummaryDetailLine(
          "Tokens",
          formatTokenSummary(averageSuiteTokens(event.result), accent),
          colors,
        ),
        stdout,
      );
      writeLine(formatSummaryDetailLine("Output", event.result.outputDir, colors), stdout);
    },
    onError() {
      if (interactiveState === undefined) {
        return;
      }

      stopSpinner(interactiveState);
      interactiveState = undefined;
    },
  };
}

function formatCaseRow(result: CaseResult, symbols: ReturnType<typeof getSymbols>): string {
  const passed = result.passed;
  const color = passed ? pc.green : pc.red;
  const cells = [
    color(padCell(`${passed ? symbols.pass : symbols.fail} ${result.caseId}`, 22)),
    padCell(formatRate(countPassedRunnerResults(result), result.runnerResults.length), 5),
    `${result.runnerResults.length} runners`,
  ];

  return cells.join("   ");
}

function formatRunnerHeading(runner: RunnerInfo): string {
  return pc.bold(`Runner: ${runner.id}`) + pc.dim(` ${formatRunnerAgentLabel(runner)}`);
}

function formatRunnerAgentLabel(runner: RunnerInfo): string {
  const model = runner.agent.model === undefined ? "" : `, ${runner.agent.model}`;
  return `(${runner.agent.type}${model})`;
}

function formatRunnerCaseRow(
  caseId: string,
  result: RunnerResult,
  symbols: ReturnType<typeof getSymbols>,
  accent: (value: string) => string,
): string {
  const color = result.passed ? pc.green : pc.red;
  const statusLabel = formatStatusLabel(result.status);
  return [
    color(padCell(`${result.passed ? symbols.pass : symbols.fail} ${caseId}`, RUNNER_CASE_WIDTH)),
    padCell(formatDuration(result.durationMs), RUNNER_TIME_WIDTH),
    statusLabel === undefined
      ? formatTokenSummary(result.report.usage, accent)
      : `${formatTokenSummary(result.report.usage, accent)} ${pc.dim(statusLabel)}`,
  ].join("   ");
}

function formatStatusLabel(status: RunnerResult["status"]): string | undefined {
  switch (status) {
    case "passed":
      return undefined;
    case "failed":
      return "unexpected failure";
    case "expected-failed":
      return "expected failure";
    case "unexpected-passed":
      return "unexpected pass";
  }
}

function formatRunnerLegend(colors: ReturnType<typeof pc.createColors>): string {
  return colors.dim(
    [
      padCell("case", RUNNER_CASE_WIDTH),
      padCell("time", RUNNER_TIME_WIDTH),
      "tokens in / out / reason / cache / billable",
    ].join("   "),
  );
}

function formatFailureMessage(failure: FailureEntry): string {
  if (failure.status === "unexpected-passed") {
    return "Expected failure passed unexpectedly.";
  }

  if (failure.failureType === "assertion") {
    if (failure.error === undefined) {
      return "Assertion failed.";
    }

    const location = formatErrorLocation(failure.error);
    return location === undefined
      ? `${failure.error.name}: ${failure.error.message}`
      : `${failure.error.name}: ${failure.error.message}\n${pc.dim(`at ${location}`)}`;
  }

  if (failure.failureType === "timeout") {
    return failure.error === undefined
      ? "Run timed out."
      : `${failure.error.name}: ${failure.error.message}`;
  }

  if (failure.failureType === "runner-crash") {
    return formatCrashMessage(failure);
  }

  if (failure.error === undefined) {
    return "Error: Retry failed";
  }

  return `${failure.error.name}: ${failure.error.message}`;
}

function formatFailureBlock(
  failure: FailureEntry,
  colors: ReturnType<typeof pc.createColors>,
  symbols: ReporterSymbols,
): string {
  const lines = [
    `${colors.red(`${symbols.fail} ${failure.caseId} > ${failure.runner.id}`)}${colors.dim(` ${formatRunnerAgentLabel(failure.runner)}`)}`,
    formatFailureMessage(failure),
  ];

  if (failure.failureLogPath !== undefined && failure.failureType !== "assertion") {
    lines.push(colors.dim(`Log: ${failure.failureLogPath}`));
  }

  lines.push(colors.dim(`Artifacts: ${failure.artifactDir}`));
  return lines.join("\n");
}

function formatFailureGroup(
  group: FailureGroup,
  colors: ReturnType<typeof pc.createColors>,
): string {
  const lines = [
    `${colors.bold(formatFailureClassLabel(group.failureClass))}${colors.dim(` (${group.failures.length})`)}`,
  ];

  for (const failure of group.failures) {
    lines.push(colors.dim(`- ${failure.caseId} > ${failure.runner.id}: ${failure.artifactDir}`));
  }

  return lines.join("\n");
}

function groupFailures(failures: FailureEntry[]): FailureGroup[] {
  const groups = new Map<string, FailureGroup>();

  for (const failure of failures) {
    const failureClass =
      failure.failureClass ??
      (failure.status === "unexpected-passed"
        ? { id: "unexpected-passed", label: "Unexpected pass" }
        : { id: "unknown", label: "Unclassified" });
    const key = failureClass.id;
    const existing = groups.get(key);

    if (existing === undefined) {
      groups.set(key, { failureClass, failures: [failure] });
      continue;
    }

    existing.failures.push(failure);
  }

  return Array.from(groups.values());
}

function formatFailureClassLabel(failureClass: FailureClass): string {
  if (failureClass.label === undefined || failureClass.label === failureClass.id) {
    return failureClass.id;
  }

  return `${failureClass.label} [${failureClass.id}]`;
}

function formatErrorLocation(error: SerializedError): string | undefined {
  const location = extractUserStackFrame(error);
  return location === undefined ? undefined : formatStackFrameLocation(location);
}

function formatCrashMessage(failure: FailureEntry): string {
  const detail = getCrashDetail(failure.failureOrigin);
  return failure.error === undefined
    ? detail
    : `${detail}\n${failure.error.name}: ${failure.error.message}`;
}

function getCrashDetail(origin: RunnerFailureOrigin | undefined): string {
  switch (origin) {
    case "workspace-bootstrap":
      return "Workspace bootstrap failed.";
    case "workspace-setup":
      return "Workspace setup failed.";
    case "assert-hook":
      return "Run finished, but the suite assert hook crashed.";
    case "max-steps":
      return "Run stopped: exceeded maxSteps (best-effort). Raw output was preserved in the run artifacts for debugging.";
    case "model-rejected":
      return "Runner rejected the configured model.";
    case "collection":
      return "Runner finished, but artifact collection failed.";
    case "normalization":
      return "Runner finished, but report normalization failed.";
    case "snapshot":
      return "Run finished, but snapshot verification failed.";
    case "runner":
    case undefined:
      return "Run did not complete because the runner crashed.";
    case "assertion":
      return "Assertion failed.";
  }
}

function formatSummaryCountLine(
  label: string,
  passed: number,
  total: number,
  colors: ReturnType<typeof pc.createColors>,
): string {
  const failed = Math.max(0, total - passed);
  const segments = [colors.green(`${passed} passed`)];

  if (failed > 0) {
    segments.unshift(colors.red(`${failed} failed`));
  }

  return `${colors.dim(padCell(label, SUMMARY_LABEL_WIDTH))} ${segments.join(colors.dim(" | "))}${colors.dim(` (${total})`)}`;
}

function formatSummaryDetailLine(
  label: string,
  value: string,
  colors: ReturnType<typeof pc.createColors>,
): string {
  return `${colors.dim(padCell(label, SUMMARY_LABEL_WIDTH))} ${value}`;
}

function formatSummaryStatusLine(
  cases: CaseResult[],
  colors: ReturnType<typeof pc.createColors>,
): string {
  const expectedFailures = countRunsByStatus(cases, "expected-failed");
  const unexpectedPasses = countRunsByStatus(cases, "unexpected-passed");
  const segments = [
    colors.green(`${expectedFailures} expected failures`),
    unexpectedPasses > 0
      ? colors.red(`${unexpectedPasses} unexpected passes`)
      : colors.dim(`${unexpectedPasses} unexpected passes`),
  ];

  return `${colors.dim(padCell("Statuses", SUMMARY_LABEL_WIDTH))} ${segments.join(colors.dim(" | "))}`;
}

function countRunsByStatus(cases: CaseResult[], status: RunnerResult["status"]): number {
  return cases.reduce((sum, caseResult) => {
    return sum + caseResult.runnerResults.filter((result) => result.status === status).length;
  }, 0);
}

function countPassedCases(cases: CaseResult[]): number {
  return cases.filter((caseResult) => caseResult.passed).length;
}

function countPassedRuns(cases: CaseResult[]): number {
  return cases.reduce((sum, caseResult) => sum + countPassedRunnerResults(caseResult), 0);
}

function countTotalRuns(cases: CaseResult[]): number {
  return cases.reduce((sum, caseResult) => sum + caseResult.runnerResults.length, 0);
}

function countPassedRunnerResults(caseResult: CaseResult): number {
  return caseResult.runnerResults.filter((result) => result.passed).length;
}

function averageSuiteTokens(result: SuiteRunResult): {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheTokens?: number;
  totalTokens?: number;
} {
  const values = result.runners;
  return {
    inputTokens: averageDefined(values.map((runner) => runner.averageInputTokens)),
    outputTokens: averageDefined(values.map((runner) => runner.averageOutputTokens)),
    reasoningTokens: averageDefined(values.map((runner) => runner.averageReasoningTokens)),
    cacheTokens: averageDefined(values.map((runner) => runner.averageCacheTokens)),
    totalTokens: averageDefined(values.map((runner) => runner.averageTotalTokens)),
  };
}

function formatTokenSummary(
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cacheTokens?: number;
    totalTokens?: number;
  },
  accent?: (value: string) => string,
): string {
  return [
    formatTokens(usage.inputTokens),
    formatTokens(usage.outputTokens),
    formatTokens(usage.reasoningTokens),
    formatTokens(usage.cacheTokens),
    accent === undefined
      ? formatTokens(usage.totalTokens)
      : accent(formatTokens(usage.totalTokens)),
  ].join(" / ");
}

function averageDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined);
  if (defined.length === 0) {
    return undefined;
  }

  return defined.reduce((sum, value) => sum + value, 0) / defined.length;
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

function createInteractiveState(event: SuiteStartEvent): InteractiveState {
  const entries = event.cases.flatMap((testCase) => {
    return event.runners.map((runner) => ({
      key: createRunKey(testCase.id, runner.id),
      caseId: testCase.id,
      runner,
      status: "queued" as const,
    }));
  });

  return {
    entries,
    entryIndexByKey: new Map(entries.map((entry, index) => [entry.key, index])),
    renderedLineCount: 0,
    spinnerFrameIndex: 0,
  };
}

function createRunKey(caseId: string, runnerId: string): string {
  return `${caseId}\u0000${runnerId}`;
}

function setInteractiveRunStatus(
  state: InteractiveState,
  key: string,
  status: InteractiveRunStatus,
): void {
  const index = state.entryIndexByKey.get(key);

  if (index === undefined) {
    return;
  }

  state.entries[index] = {
    ...state.entries[index]!,
    status,
  };
}

function startSpinner(
  state: InteractiveState,
  stdout: Pick<NodeJS.WriteStream, "write">,
  colors: ReturnType<typeof pc.createColors>,
  symbols: ReturnType<typeof getSymbols>,
  frames: string[],
  interval: number,
): void {
  if (state.timer !== undefined) {
    return;
  }

  state.timer = setInterval(() => {
    state.spinnerFrameIndex = (state.spinnerFrameIndex + 1) % frames.length;
    renderInteractiveRunList(state, stdout, colors, symbols, frames);
  }, interval);
}

function stopSpinner(state: InteractiveState): void {
  if (state.timer === undefined) {
    return;
  }

  clearInterval(state.timer);
  state.timer = undefined;
}

function hasRunningEntries(state: InteractiveState): boolean {
  return state.entries.some((entry) => entry.status === "running");
}

function renderInteractiveRunList(
  state: InteractiveState,
  stdout: Pick<NodeJS.WriteStream, "write">,
  colors: ReturnType<typeof pc.createColors>,
  symbols: ReturnType<typeof getSymbols>,
  frames: string[],
): void {
  const caseWidth = state.entries.reduce(
    (max, entry) => Math.max(max, visibleWidth(entry.caseId)),
    0,
  );
  const lines = state.entries.map((entry) =>
    formatInteractiveRunRow(entry, state, colors, symbols, frames, caseWidth),
  );
  state.renderedLineCount = redrawLines(lines, stdout, state.renderedLineCount);
}

function formatInteractiveRunRow(
  entry: InteractiveRunEntry,
  state: InteractiveState,
  colors: ReturnType<typeof pc.createColors>,
  symbols: ReturnType<typeof getSymbols>,
  frames: string[],
  caseWidth: number,
): string {
  const statusIcon = formatInteractiveStatusIcon(entry, state, colors, symbols, frames);
  const statusLabel = formatInteractiveStatusLabel(entry.status);
  const row = `${statusIcon} ${padCell(entry.caseId, caseWidth)}  /  ${entry.runner.id}${statusLabel}`;
  const runnerMeta = ` ${formatRunnerAgentLabel(entry.runner)}`;

  switch (entry.status) {
    case "queued":
      return colors.dim(`${row}${runnerMeta}`);
    case "running":
      return `${row}${colors.dim(runnerMeta)}`;
    case "passed":
    case "expected-failed":
      return `${colors.green(row)}${colors.dim(runnerMeta)}`;
    case "failed":
    case "unexpected-passed":
      return `${colors.red(row)}${colors.dim(runnerMeta)}`;
  }
}

function formatInteractiveStatusLabel(status: InteractiveRunStatus): string {
  switch (status) {
    case "expected-failed":
      return " expected failure";
    case "unexpected-passed":
      return " unexpected pass";
    case "failed":
      return " unexpected failure";
    case "queued":
    case "running":
    case "passed":
      return "";
  }
}

function formatInteractiveStatusIcon(
  entry: InteractiveRunEntry,
  state: InteractiveState,
  colors: ReturnType<typeof pc.createColors>,
  symbols: ReturnType<typeof getSymbols>,
  frames: string[],
): string {
  const accent = (value: string): string =>
    colors.isColorSupported ? `${ACCENT_OPEN}${value}${ACCENT_CLOSE}` : value;

  switch (entry.status) {
    case "queued":
      return symbols.bullet;
    case "running":
      return accent(frames[state.spinnerFrameIndex] ?? frames[0] ?? symbols.bullet);
    case "passed":
    case "expected-failed":
      return symbols.pass;
    case "failed":
    case "unexpected-passed":
      return symbols.fail;
  }
}

function redrawLines(
  lines: string[],
  stdout: Pick<NodeJS.WriteStream, "write">,
  previousLineCount: number,
): number {
  const lineCount = Math.max(previousLineCount, lines.length);

  if (previousLineCount > 0) {
    stdout.write(`\x1b[${previousLineCount}A`);
  }

  for (let index = 0; index < lineCount; index += 1) {
    stdout.write("\r\x1b[2K");
    stdout.write(lines[index] ?? "");
    stdout.write("\n");
  }

  return lineCount;
}

function writeLine(value: string, stdout: Pick<NodeJS.WriteStream, "write">): void {
  stdout.write(`${value}\n`);
}
