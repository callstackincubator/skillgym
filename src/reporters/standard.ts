import path from "node:path";
import process from "node:process";
import cliSpinners from "cli-spinners";
import pc from "picocolors";
import type { CaseResult, RunnerFailureType, RunnerResult, SerializedError, SuiteRunResult } from "../domain/result.js";
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

interface FailureEntry {
  caseId: string;
  runner: RunnerInfo;
  artifactDir: string;
  error?: SerializedError;
  failureType?: RunnerFailureType;
}

interface StandardReporterOptions {
  stdout?: Pick<NodeJS.WriteStream, "write" | "isTTY" | "columns">;
  isInteractive?: boolean;
  isUnicode?: boolean;
}

type InteractiveRunStatus = "queued" | "running" | "passed" | "failed";

interface InteractiveRunEntry {
  key: string;
  caseId: string;
  runnerId: string;
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

export function createStandardReporter(options: StandardReporterOptions = {}): BenchmarkReporter {
  const stdout = options.stdout ?? process.stdout;
  const interactive = options.isInteractive ?? Boolean(stdout.isTTY);
  const unicode = options.isUnicode ?? process.platform !== "win32";
  const colors = pc.createColors(Boolean(stdout.isTTY));
  const accent = (value: string): string => colors.isColorSupported ? `${ACCENT_OPEN}${value}${ACCENT_CLOSE}` : value;
  const symbols: ReporterSymbols = getSymbols(unicode);
  const spinner = unicode ? cliSpinners.dots : cliSpinners.line;
  const failures: FailureEntry[] = [];
  let interactiveState: InteractiveState | undefined;

  return {
    onSuiteStart(event) {
      writeLine(`${colors.dim("Suite     ")}${accent(event.context.suitePath)}`, stdout);
      writeLine(`${colors.dim("Workspace ")}${colors.bold(event.context.workspaceMode === "shared" ? event.context.cwd : `${event.context.workspaceMode} per run`)}`, stdout);
      writeLine(`${colors.dim("Output    ")}${colors.bold(event.context.outputDir)}`, stdout);
      writeLine(`${colors.dim("Cases     ")}${String(event.context.selectedCaseCount)}`, stdout);
      writeLine(`${colors.dim("Runners   ")}${String(event.context.selectedRunnerCount)}`, stdout);
      writeLine(`${colors.dim("Runs      ")}${String(event.context.selectedExecutionCount)}`, stdout);

      if (event.context.scheduleMode !== "serial" && event.context.workspaceMode === "shared") {
        writeLine(
          colors.yellow(`${symbols.warning} Concurrent schedule: ${event.context.scheduleMode} runs may overlap in the same workspace.`),
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
        setInteractiveRunStatus(interactiveState, createRunKey(event.testCase.id, event.runner.id), event.result.passed ? "passed" : "failed");
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
        for (const caseResult of getRunnerCases(event.result, summary.runner.id)) {
          writeLine(formatRunnerCaseRow(caseResult.caseId, caseResult.runnerResult, symbols), stdout);
        }
        writeLine("", stdout);
      }

      writeLine(colors.bold("Summary"), stdout);
      writeLine("", stdout);
      writeLine(
        `${colors.dim("Passed cases   ")}${formatRate(countPassedCases(event.result.cases), event.result.cases.length)}`,
        stdout,
      );
      writeLine(
        `${colors.dim("Passed runs    ")}${formatRate(countPassedRuns(event.result.cases), countTotalRuns(event.result.cases))}`,
        stdout,
      );
      writeLine(
        `${colors.dim("Success rate   ")}${formatPercent(countPassedRuns(event.result.cases) / Math.max(1, countTotalRuns(event.result.cases)))}`,
        stdout,
      );
      writeLine(
        `${colors.dim("Avg tok/run   ")}${formatTokens(averageSuiteTokens(event.result))}`,
        stdout,
      );
      writeLine(`${colors.dim("Total time     ")}${formatDuration(event.result.durationMs)}`, stdout);
      writeLine(`${colors.dim("Output dir     ")}${event.result.outputDir}`, stdout);

      if (failures.length > 0) {
        writeLine("", stdout);
        writeLine(colors.bold("Failures"), stdout);
        writeLine("", stdout);

        for (const failure of failures) {
          writeLine(`${failure.caseId}  ${colors.dim(failure.runner.id)}`, stdout);
          writeLine(formatFailureMessage(failure), stdout);
          writeLine(`${colors.dim("Artifacts:")} ${failure.artifactDir}`, stdout);
          writeLine("", stdout);
        }
      }
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
  const model = runner.agent.model === undefined ? "" : `, ${runner.agent.model}`;
  return pc.bold(`Runner: ${runner.id}`) + pc.dim(` (${runner.agent.type}${model})`);
}

function formatRunnerCaseRow(caseId: string, result: RunnerResult, symbols: ReturnType<typeof getSymbols>): string {
  const color = result.passed ? pc.green : pc.red;
  return [
    color(padCell(`${result.passed ? symbols.pass : symbols.fail} ${caseId}`, 24)),
    padCell(formatDuration(result.durationMs), 12),
    `${formatTokens(result.report.usage.totalTokens ?? result.report.usage.completionTokens)} tok`,
  ].join("   ");
}

function formatFailureMessage(failure: FailureEntry): string {
  if (failure.failureType === "runner-crash") {
    return `Runner crashed. See ${path.join(failure.artifactDir, "stderr.log")} for details.`;
  }

  if (failure.error === undefined) {
    return "Error: Retry failed";
  }

  return `${failure.error.name}: ${failure.error.message}`;
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

function averageSuiteTokens(result: SuiteRunResult): number | undefined {
  const values = result.runners
    .map((runner) => runner.averageTotalTokens ?? runner.averageCompletionTokens)
    .filter((value): value is number => value !== undefined);

  if (values.length === 0) {
    return undefined;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
      runnerId: runner.id,
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

function setInteractiveRunStatus(state: InteractiveState, key: string, status: InteractiveRunStatus): void {
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
  const caseWidth = state.entries.reduce((max, entry) => Math.max(max, visibleWidth(entry.caseId)), 0);
  const lines = state.entries.map((entry) => formatInteractiveRunRow(entry, state, colors, symbols, frames, caseWidth));
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
  const row = `${statusIcon} ${padCell(entry.caseId, caseWidth)}  /  ${entry.runnerId}`;

  switch (entry.status) {
    case "queued":
      return colors.dim(row);
    case "running":
      return row;
    case "passed":
      return colors.green(row);
    case "failed":
      return colors.red(row);
  }
}

function formatInteractiveStatusIcon(
  entry: InteractiveRunEntry,
  state: InteractiveState,
  colors: ReturnType<typeof pc.createColors>,
  symbols: ReturnType<typeof getSymbols>,
  frames: string[],
): string {
  const accent = (value: string): string => colors.isColorSupported ? `${ACCENT_OPEN}${value}${ACCENT_CLOSE}` : value;

  switch (entry.status) {
    case "queued":
      return symbols.bullet;
    case "running":
      return accent(frames[state.spinnerFrameIndex] ?? frames[0] ?? symbols.bullet);
    case "passed":
      return symbols.pass;
    case "failed":
      return symbols.fail;
  }
}

function redrawLines(lines: string[], stdout: Pick<NodeJS.WriteStream, "write">, previousLineCount: number): number {
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
