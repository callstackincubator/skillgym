export interface JudgeInput {
  model: string;
  prompt: string;
  timeoutMs: number;
}

export interface JudgeVerdict {
  verdict: "pass" | "fail";
  score: number;
  reason: string;
}

export function parseJudgeVerdict(finalText: string): JudgeVerdict {
  const trimmed = finalText.trim();
  const candidates = collectJudgeJsonCandidates(trimmed);

  if (candidates.length === 0) {
    throw new Error("Judge output did not contain a JSON object.");
  }

  let lastJsonError: Error | undefined;

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return validateJudgeVerdict(parsed);
    } catch (error) {
      if (error instanceof SyntaxError) {
        lastJsonError = error;
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    lastJsonError?.message === "Unexpected end of JSON input"
      ? "Judge output contained incomplete JSON."
      : "Judge output contained invalid JSON.",
  );
}

function collectJudgeJsonCandidates(text: string): string[] {
  const candidates: string[] = [];

  if (looksLikeJsonObject(text)) {
    candidates.push(text);
  }

  const fenced = extractFencedJson(text);
  if (fenced !== undefined) {
    candidates.push(fenced);
  }

  const embedded = extractEmbeddedJsonObject(text);
  if (embedded !== undefined) {
    candidates.push(embedded);
  }

  return [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))];
}

function looksLikeJsonObject(text: string): boolean {
  return text.startsWith("{") && text.endsWith("}");
}

function extractFencedJson(text: string): string | undefined {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match?.[1];
}

function extractEmbeddedJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start < 0 || end < 0 || end <= start) {
    return undefined;
  }

  return text.slice(start, end + 1);
}

function validateJudgeVerdict(value: unknown): JudgeVerdict {
  if (!isRecord(value)) {
    throw new Error("Judge output must be a JSON object.");
  }

  if (value.verdict !== "pass" && value.verdict !== "fail") {
    throw new Error('Judge verdict must be "pass" or "fail".');
  }

  if (typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > 1) {
    throw new Error("Judge score must be a finite number between 0 and 1.");
  }

  if (typeof value.reason !== "string" || value.reason.trim().length === 0) {
    throw new Error("Judge reason must be a non-empty string.");
  }

  return {
    verdict: value.verdict,
    score: value.score,
    reason: value.reason,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
