import assert from "node:assert/strict";
import type { SkillDetection } from "../domain/session-report.js";
import type { SessionReport } from "../domain/session-report.js";
import { composeAssertionMessage } from "./matchers.js";
import type { SkillAssertionOptions, SkillAssertions } from "./types.js";

const confidenceRank = {
  weak: 0,
  medium: 1,
  strong: 2,
  explicit: 3,
} as const;

export const skillAssertions: SkillAssertions = {
  has(report, skill, options) {
    assert.ok(
      getMatchingSkills(report, skill, options).length > 0,
      composeAssertionMessage(
        `Expected detectedSkills to include ${JSON.stringify(skill)}${formatMinConfidence(options)}.`,
        formatObservedSkills(report.detectedSkills),
        options?.message,
      ),
    );
  },
  notHas(report, skill, options) {
    assert.equal(
      getMatchingSkills(report, skill, options).length,
      0,
      composeAssertionMessage(
        `Expected detectedSkills not to include ${JSON.stringify(skill)}${formatMinConfidence(options)}.`,
        formatObservedSkills(report.detectedSkills),
        options?.message,
      ),
    );
  },
  includes(report, skills, options) {
    const missing = skills.filter(
      (skill) => getMatchingSkills(report, skill, options).length === 0,
    );

    assert.equal(
      missing.length,
      0,
      composeAssertionMessage(
        `Expected detectedSkills to include all of: ${skills.map((skill) => JSON.stringify(skill)).join(", ")}${formatMinConfidence(options)}. Missing: ${missing.map((skill) => JSON.stringify(skill)).join(", ") || "(none)"}.`,
        formatObservedSkills(report.detectedSkills),
        options?.message,
      ),
    );
  },
  count(report, skill, expected, options) {
    const actual = getMatchingSkills(report, skill, options).length;

    assert.equal(
      actual,
      expected,
      composeAssertionMessage(
        `Expected detectedSkills to include ${JSON.stringify(skill)} exactly ${expected} time(s)${formatMinConfidence(options)}, but found ${actual}.`,
        formatObservedSkills(report.detectedSkills),
        options?.message,
      ),
    );
  },
  exactlyOne(report, skill, options) {
    const actual = getMatchingSkills(report, skill, options).length;

    assert.equal(
      actual,
      1,
      composeAssertionMessage(
        `Expected detectedSkills to include ${JSON.stringify(skill)} exactly once${formatMinConfidence(options)}, but found ${actual}.`,
        formatObservedSkills(report.detectedSkills),
        options?.message,
      ),
    );
  },
  only(report, skills, options) {
    const unexpected = report.detectedSkills.filter(
      (item) => meetsMinConfidence(item, options?.minConfidence) && !skills.includes(item.skill),
    );

    assert.equal(
      unexpected.length,
      0,
      composeAssertionMessage(
        `Expected detectedSkills to contain only: ${skills.map((skill) => JSON.stringify(skill)).join(", ") || "(none)"}${formatMinConfidence(options)}. Unexpected: ${unexpected.map((item) => `${item.skill} (${item.confidence})`).join(" | ") || "(none)"}.`,
        formatObservedSkills(report.detectedSkills),
        options?.message,
      ),
    );
  },
};

function getMatchingSkills(
  report: SessionReport,
  skill: string,
  options?: SkillAssertionOptions,
): SkillDetection[] {
  return report.detectedSkills.filter(
    (item) => item.skill === skill && meetsMinConfidence(item, options?.minConfidence),
  );
}

function meetsMinConfidence(
  item: SkillDetection,
  minConfidence: SkillAssertionOptions["minConfidence"],
): boolean {
  if (minConfidence === undefined) {
    return true;
  }

  return confidenceRank[item.confidence] >= confidenceRank[minConfidence];
}

function formatMinConfidence(options?: SkillAssertionOptions): string {
  return options?.minConfidence === undefined
    ? ""
    : ` with minimum confidence ${options.minConfidence}`;
}

function formatObservedSkills(skills: readonly SkillDetection[]): string {
  if (skills.length === 0) {
    return "Observed detectedSkills: (none)";
  }

  return `Observed detectedSkills: ${skills.map((item) => `${item.skill} (${item.confidence})`).join(" | ")}`;
}
