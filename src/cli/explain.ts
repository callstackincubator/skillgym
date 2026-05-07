import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.js";
import { getAdapter } from "../adapters/index.js";
import type { ExplainArtifact, ExplanationsArtifact } from "../domain/explain.js";
import type { SessionReport } from "../domain/session-report.js";
import { formatStackFrameLocation } from "../reporters/stack-frame.js";
import { writeJson } from "../utils/fs.js";
import { nowIso } from "../utils/time.js";

const EXPLAIN_TIMEOUT_MS = 300_000;

export async function explainCommand(options: { artifactDir: string }): Promise<void> {
  const artifactDir = path.resolve(options.artifactDir);
  const explainPath = path.join(artifactDir, "explain.json");
  const explanationsPath = path.join(artifactDir, "explanations.json");
  const reportPath = path.join(artifactDir, "report.json");

  await assertMissing(
    explanationsPath,
    "Explain output already exists for this artifact directory.",
  );

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

  console.log(`Explaining ${explain.caseId} with ${explain.runnerId}`);
  for (const question of explain.questions) {
    console.log(`${formatStackFrameLocation(question.source)} ${question.question}`);
  }

  const result = await adapter.explain({
    runner: report.runner,
    cwd: explain.cwd,
    timeoutMs: EXPLAIN_TIMEOUT_MS,
    artifactDir,
    sessionId: explain.sessionId,
    questions: explain.questions,
  });

  const explanations: ExplanationsArtifact = {
    suitePath: explain.suitePath,
    caseId: explain.caseId,
    runnerId: explain.runnerId,
    cwd: explain.cwd,
    sessionId: explain.sessionId,
    createdAt: nowIso(),
    questions: result.answers.map((answer) => ({
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
  console.log(`Saved explanations to ${explanationsPath}`);
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

async function assertMissing(filePath: string, message: string): Promise<void> {
  try {
    await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }

    throw error;
  }

  throw new Error(message);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
