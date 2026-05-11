import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import cliSpinners from "cli-spinners";
import pc from "picocolors";
import { printBanner, createCliTheme } from "./branding.js";
import { loadConfig } from "../config.js";
import { getAdapter } from "../adapters/index.js";
import type { ExplainArtifact, ExplanationsArtifact } from "../domain/explain.js";
import type { SessionReport } from "../domain/session-report.js";
import { formatStackFrameLocation } from "../reporters/stack-frame.js";
import { writeJson } from "../utils/fs.js";
import { nowIso } from "../utils/time.js";

const EXPLAIN_TIMEOUT_MS = 300_000;
const ACCENT_OPEN = "\x1b[38;5;141m";
const ACCENT_CLOSE = "\x1b[0m";

export async function explainCommand(options: {
  artifactDir: string;
  rerun?: boolean;
}): Promise<void> {
  const stdout = process.stdout;
  return await explainCommandWithWriter(options, stdout);
}

export async function explainCommandWithWriter(
  options: { artifactDir: string; rerun?: boolean },
  stdout: NodeJS.WriteStream | Pick<NodeJS.WriteStream, "write" | "isTTY">,
): Promise<void> {
  const theme = createCliTheme(stdout);
  const colors = pc.createColors(Boolean(stdout.isTTY));
  const accent = (value: string): string =>
    colors.isColorSupported ? `${ACCENT_OPEN}${value}${ACCENT_CLOSE}` : value;
  const artifactDir = path.resolve(options.artifactDir);
  const explainPath = path.join(artifactDir, "explain.json");
  const explanationsPath = path.join(artifactDir, "explanations.json");
  const reportPath = path.join(artifactDir, "report.json");

  const existingExplanations = await readJsonIfPresent<ExplanationsArtifact>(explanationsPath);

  if (existingExplanations !== undefined && options.rerun !== true) {
    printBanner({ kind: "compact", stdout });
    renderExplainHeader(
      {
        caseId: existingExplanations.caseId,
        runnerId: existingExplanations.runnerId,
        questionCount: existingExplanations.questions.length,
        artifactDir,
      },
      stdout,
      theme,
      accent,
    );
    writeLine(
      `${colors.yellow("Reusing existing explanations artifact")}${theme.dim(". Pass --rerun to refresh it.")}`,
      stdout,
    );
    writeLine("", stdout);
    renderExplanations(existingExplanations, stdout, theme);
    writeLine(`${colors.green("Saved explanations")}${theme.dim(` ${explanationsPath}`)}`, stdout);
    return;
  }

  const [report, explain] = await Promise.all([
    readJson<SessionReport>(reportPath, "Missing report.json in the provided artifact directory."),
    readJson<ExplainArtifact>(
      explainPath,
      "Missing explain.json in the provided artifact directory.",
    ),
  ]);

  if (explain.sessionId === undefined || explain.sessionId.length === 0) {
    throw new Error(
      "Explain data is missing a sessionId, so the original runner session cannot be resumed.",
    );
  }

  if (explain.questions.length === 0) {
    throw new Error("Explain data did not contain any persisted questions.");
  }

  const loadedConfig = await loadConfig({ suitePath: explain.suitePath });
  const runnerConfig = loadedConfig.config.runners[explain.runnerId];
  if (runnerConfig === undefined) {
    throw new Error(`No runner config matches explain runner id: ${explain.runnerId}`);
  }

  const adapter = getAdapter(runnerConfig.agent);

  printBanner({ kind: "compact", stdout });
  renderExplainHeader(
    {
      caseId: explain.caseId,
      runnerId: explain.runnerId,
      questionCount: explain.questions.length,
      artifactDir,
    },
    stdout,
    theme,
    accent,
  );

  if (existingExplanations !== undefined && options.rerun === true) {
    writeLine(
      colors.yellow("Re-running explain and overwriting existing explanations artifact."),
      stdout,
    );
    writeLine("", stdout);
  }

  const answers = [];

  for (const [index, question] of explain.questions.entries()) {
    writeLine(
      `${theme.bold(`Question ${String(index + 1)}`)} ${theme.dim(`(${formatStackFrameLocation(question.source)})`)}`,
      stdout,
    );
    writeLine(question.question, stdout);
    writeLine("", stdout);

    const spinner = createSpinner(`Waiting for ${explain.runnerId}...`, stdout, colors);
    spinner.start();

    let answer;
    try {
      const result = await adapter.explain({
        runner: report.runner,
        cwd: explain.cwd,
        timeoutMs: EXPLAIN_TIMEOUT_MS,
        artifactDir,
        sessionId: explain.sessionId,
        questions: [question],
        showRunnerOutput: false,
      });
      answer = result.answers[0];
    } finally {
      spinner.stop();
    }

    if (answer === undefined) {
      throw new Error(`Runner returned no answer for explain question ${String(index + 1)}.`);
    }

    answers.push(answer);
    writeLine(theme.accent("Agent"), stdout);
    writeLine(answer.answer, stdout);
    writeLine("", stdout);
  }

  const explanations: ExplanationsArtifact = {
    suitePath: explain.suitePath,
    caseId: explain.caseId,
    runnerId: explain.runnerId,
    cwd: explain.cwd,
    sessionId: explain.sessionId,
    createdAt: nowIso(),
    questions: answers.map((answer) => ({
      question: answer.question.question,
      source: answer.question.source,
      answer: answer.answer,
      sessionId: answer.sessionId,
      startedAt: answer.startedAt,
      endedAt: answer.endedAt,
      durationMs: answer.durationMs,
      rawArtifacts: answer.rawArtifacts,
    })),
  };

  await writeJson(explanationsPath, explanations);
  writeLine(`${colors.green("Saved explanations")}${theme.dim(` ${explanationsPath}`)}`, stdout);
}

async function readJson<T>(filePath: string, missingMessage: string): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(missingMessage);
    }

    throw error;
  }
}

async function readJsonIfPresent<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function writeLine(value: string, stdout: Pick<NodeJS.WriteStream, "write">): void {
  stdout.write(`${value}\n`);
}

function renderExplainHeader(
  options: {
    caseId: string;
    runnerId: string;
    questionCount: number;
    artifactDir: string;
  },
  stdout: Pick<NodeJS.WriteStream, "write">,
  theme: ReturnType<typeof createCliTheme>,
  accent: (value: string) => string,
): void {
  writeLine(`${theme.dim("Case      ")}${theme.bold(options.caseId)}`, stdout);
  writeLine(`${theme.dim("Runner    ")}${accent(options.runnerId)}`, stdout);
  writeLine(`${theme.dim("Artifact Directory ")}${theme.bold(options.artifactDir)}`, stdout);
  writeLine(`${theme.dim("Questions ")}${String(options.questionCount)}`, stdout);
  writeLine("", stdout);
}

function renderExplanations(
  explanations: ExplanationsArtifact,
  stdout: Pick<NodeJS.WriteStream, "write">,
  theme: ReturnType<typeof createCliTheme>,
): void {
  for (const [index, question] of explanations.questions.entries()) {
    writeLine(
      `${theme.bold(`Question ${String(index + 1)}`)} ${theme.dim(`(${formatStackFrameLocation(question.source)})`)}`,
      stdout,
    );
    writeLine(question.question, stdout);
    writeLine("", stdout);
    writeLine(theme.accent("Agent"), stdout);
    writeLine(question.answer, stdout);
    writeLine("", stdout);
  }
}

function createSpinner(
  label: string,
  stdout: Pick<NodeJS.WriteStream, "write" | "isTTY">,
  colors: ReturnType<typeof pc.createColors>,
): {
  start(): void;
  stop(): void;
} {
  if (!stdout.isTTY) {
    return {
      start() {
        writeLine(label, stdout);
      },
      stop() {},
    };
  }

  const spinner = process.platform === "win32" ? cliSpinners.line : cliSpinners.dots;
  let frameIndex = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const render = (): void => {
    const frame = spinner.frames[frameIndex] ?? spinner.frames[0] ?? "-";
    stdout.write(`\r${colors.dim(frame)} ${label}`);
    frameIndex = (frameIndex + 1) % spinner.frames.length;
  };

  return {
    start() {
      render();
      timer = setInterval(render, spinner.interval);
      timer.unref?.();
    },
    stop() {
      if (timer !== undefined) {
        clearInterval(timer);
      }
      stdout.write("\r\x1b[2K");
    },
  };
}
