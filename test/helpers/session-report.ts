import type { SessionEvent, SessionReport } from "../../src/index.ts";
import { createRunnerInfo } from "../../src/runner/runner-info.ts";

export function createSessionReport(overrides: Partial<SessionReport> = {}): SessionReport {
  return {
    runner: overrides.runner ?? createRunnerInfo("opencode", { type: "opencode", model: "openai/gpt-5" }),
    prompt: "test prompt",
    usage: {
      totalTokens: undefined,
      completionTokens: undefined,
      inputChars: 10,
      outputChars: 5,
      reasoningChars: 0,
      source: {
        input: "chars",
        output: "chars",
        reasoning: "chars",
      },
      ...overrides.usage,
    },
    files: {
      observedReads: [],
      observedSkillReads: [],
      ...overrides.files,
    },
    detectedSkills: overrides.detectedSkills ?? [],
    events: overrides.events ?? ([] as SessionEvent[]),
    finalOutput: overrides.finalOutput ?? "",
    rawArtifacts: overrides.rawArtifacts ?? {},
    sessionId: overrides.sessionId,
    startedAt: overrides.startedAt,
    endedAt: overrides.endedAt,
    durationMs: overrides.durationMs,
  };
}
