import { AssertionError } from "node:assert";
import type { SessionReport } from "../domain/session-report.js";
import type { ExplainQuestionArtifact } from "../domain/explain.js";
import { extractUserStackFrameFromStack } from "../reporters/stack-frame.js";

const EXPLAIN_QUESTIONS_SYMBOL = Symbol.for("skillgym.explainQuestions");

type ErrorWithExplainQuestions = Error & {
  [EXPLAIN_QUESTIONS_SYMBOL]?: ExplainQuestionArtifact[];
};

export interface ExplainQuestionContext {
  report: SessionReport;
  expected?: unknown;
  actual?: unknown;
  observed?: unknown;
}

export interface ExplainOptions {
  question: string | ((ctx: ExplainQuestionContext) => string | undefined);
}

export interface ExplainableAssertionOptions {
  explain?: ExplainOptions;
}

export function captureExplainableAssertion(
  callback: () => void,
  options: {
    report: SessionReport;
    assertionOptions?: ExplainableAssertionOptions;
    expected?: unknown;
    actual?: unknown;
    observed?: unknown;
    buildQuestion?: (ctx: ExplainQuestionContext) => string | undefined;
  },
): void {
  try {
    callback();
  } catch (error) {
    if (!(error instanceof AssertionError)) {
      throw error;
    }

    const question = buildExplainQuestion(error, options);
    if (question !== undefined) {
      attachExplainQuestions(error, [question]);
    }

    throw error;
  }
}

export function attachExplainQuestions(
  error: unknown,
  questions: readonly ExplainQuestionArtifact[],
): void {
  if (!(error instanceof Error) || questions.length === 0) {
    return;
  }

  (error as ErrorWithExplainQuestions)[EXPLAIN_QUESTIONS_SYMBOL] = [...questions];
}

export function getAttachedExplainQuestions(error: unknown): ExplainQuestionArtifact[] {
  if (!(error instanceof Error)) {
    return [];
  }

  return [...((error as ErrorWithExplainQuestions)[EXPLAIN_QUESTIONS_SYMBOL] ?? [])];
}

function buildExplainQuestion(
  error: AssertionError,
  options: {
    report: SessionReport;
    assertionOptions?: ExplainableAssertionOptions;
    expected?: unknown;
    actual?: unknown;
    observed?: unknown;
    buildQuestion?: (ctx: ExplainQuestionContext) => string | undefined;
  },
): ExplainQuestionArtifact | undefined {
  const source = extractUserStackFrameFromStack(error.stack);
  if (source === undefined) {
    return undefined;
  }

  const ctx: ExplainQuestionContext = {
    report: options.report,
    expected: options.expected,
    actual: options.actual,
    observed: options.observed,
  };
  const customQuestion = renderCustomExplainQuestion(
    options.assertionOptions?.explain?.question,
    ctx,
  );
  const fallbackQuestion = options.buildQuestion?.(ctx);
  const question = customQuestion ?? fallbackQuestion;

  if (question === undefined || question.trim().length === 0) {
    return undefined;
  }

  return {
    question,
    source,
  };
}

function renderCustomExplainQuestion(
  question: ExplainOptions["question"] | undefined,
  ctx: ExplainQuestionContext,
): string | undefined {
  if (question === undefined) {
    return undefined;
  }

  return typeof question === "string" ? question : question(ctx);
}
