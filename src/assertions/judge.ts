import { AssertionError } from "node:assert";
import { getAdapter } from "../adapters/index.js";
import type { JudgeInput } from "../domain/judge.js";
import type { JudgeAssertionOptions, JudgeAssertionResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const JUDGE_OPERATOR = "llmJudge";

export async function judge(options: JudgeAssertionOptions): Promise<JudgeAssertionResult> {
  const agent = requireNonEmptyText(options.agent, "agent") as JudgeAssertionOptions["agent"];
  const model = requireNonEmptyText(options.model, "model");
  const rubric = requireNonEmptyText(options.rubric, "rubric");
  const input = requireNonEmptyText(options.input, "input");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  requireValidTimeout(timeoutMs);
  requireValidThreshold(options.threshold);

  const adapter = getAdapter({
    type: agent,
    model,
  });

  const verdict = await adapter.judge({
    model,
    prompt: buildJudgePrompt(rubric, input),
    timeoutMs,
  } satisfies JudgeInput);

  if (options.threshold !== undefined && verdict.score < options.threshold) {
    throw createJudgeAssertionError({
      reason: verdict.reason,
      score: verdict.score,
      customMessage: options.message,
      detail: `Expected judge score to be at least ${options.threshold}.`,
      expected: `score >= ${options.threshold}`,
    });
  }

  if (verdict.verdict === "fail") {
    throw createJudgeAssertionError({
      reason: verdict.reason,
      score: verdict.score,
      customMessage: options.message,
      detail: "Expected judge verdict to pass.",
      expected: "pass",
    });
  }

  return {
    score: verdict.score,
    reason: verdict.reason,
  };
}

function buildJudgePrompt(rubric: string, input: string): string {
  return [
    "Judge INPUT against RUBRIC.",
    "Return JSON only with keys verdict, score, reason.",
    'verdict: "pass" or "fail".',
    "score: number from 0 to 1.",
    "Pass when score is at least 0.5.",
    "",
    "<<<RUBRIC>>>",
    rubric,
    "<<<END RUBRIC>>>",
    "",
    "<<<INPUT>>>",
    input,
    "<<<END INPUT>>>",
  ].join("\n");
}

function requireNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`assert.judge requires non-empty ${label}.`);
  }

  return value;
}

function requireValidTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("assert.judge timeoutMs must be a positive finite number.");
  }
}

function requireValidThreshold(threshold: number | undefined): void {
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) {
    throw new RangeError("assert.judge threshold must be a number between 0 and 1.");
  }
}

function createJudgeAssertionError(options: {
  reason: string;
  score: number;
  detail: string;
  expected: unknown;
  customMessage?: string;
}): AssertionError {
  const message = composeJudgeAssertionMessage(
    options.detail,
    `Score: ${options.score}. Reason: ${options.reason}`,
    options.customMessage,
  );

  return new AssertionError({
    message,
    actual: options.score,
    expected: options.expected,
    operator: JUDGE_OPERATOR,
  });
}

function composeJudgeAssertionMessage(
  detail: string,
  observed: string,
  customMessage?: string,
): string {
  if (customMessage === undefined) {
    return `${detail} ${observed}`;
  }

  return `${customMessage}. ${detail} ${observed}`;
}
