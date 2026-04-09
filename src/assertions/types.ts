import type nodeAssert from "node:assert/strict";
import type { SessionReport, ToolCallEvent } from "../domain/session-report.js";

export type Matcher = string | RegExp;
export type SkillConfidence = "weak" | "medium" | "strong" | "explicit";

export interface ToolCallMatcher {
  tool?: Matcher;
  where?: (args: unknown, event: ToolCallEvent) => boolean;
}

export interface SkillAssertionOptions {
  minConfidence?: SkillConfidence;
  message?: string;
}

export interface AssertionOptions {
  message?: string;
}

export interface SkillAssertions {
  has(report: SessionReport, skill: string, options?: SkillAssertionOptions): void;
  notHas(report: SessionReport, skill: string, options?: SkillAssertionOptions): void;
  includes(report: SessionReport, skills: readonly string[], options?: SkillAssertionOptions): void;
  count(report: SessionReport, skill: string, expected: number, options?: SkillAssertionOptions): void;
  exactlyOne(report: SessionReport, skill: string, options?: SkillAssertionOptions): void;
  only(report: SessionReport, skills: readonly string[], options?: SkillAssertionOptions): void;
}

export interface CommandAssertions {
  includes(report: SessionReport, matcher: Matcher, options?: AssertionOptions): void;
  notIncludes(report: SessionReport, matcher: Matcher, options?: AssertionOptions): void;
  count(report: SessionReport, matcher: Matcher, expected: number, options?: AssertionOptions): void;
  atLeast(report: SessionReport, matcher: Matcher, min: number, options?: AssertionOptions): void;
  atMost(report: SessionReport, matcher: Matcher, max: number, options?: AssertionOptions): void;
  before(report: SessionReport, firstMatcher: Matcher, secondMatcher: Matcher, options?: AssertionOptions): void;
  only(report: SessionReport, matchers: readonly Matcher[], options?: AssertionOptions): void;
  size(report: SessionReport, expected: number, options?: AssertionOptions): void;
  exactlyOne(report: SessionReport, matcher: Matcher, options?: AssertionOptions): void;
  first(report: SessionReport, matcher: Matcher, options?: AssertionOptions): void;
  last(report: SessionReport, matcher: Matcher, options?: AssertionOptions): void;
}

export interface FileReadAssertions {
  includes(report: SessionReport, matcher: Matcher, options?: AssertionOptions): void;
  notIncludes(report: SessionReport, matcher: Matcher, options?: AssertionOptions): void;
  count(report: SessionReport, matcher: Matcher, expected: number, options?: AssertionOptions): void;
  atLeast(report: SessionReport, matcher: Matcher, min: number, options?: AssertionOptions): void;
  atMost(report: SessionReport, matcher: Matcher, max: number, options?: AssertionOptions): void;
  before(report: SessionReport, firstMatcher: Matcher, secondMatcher: Matcher, options?: AssertionOptions): void;
  only(report: SessionReport, matchers: readonly Matcher[], options?: AssertionOptions): void;
  size(report: SessionReport, expected: number, options?: AssertionOptions): void;
  exactlyOne(report: SessionReport, matcher: Matcher, options?: AssertionOptions): void;
  first(report: SessionReport, matcher: Matcher, options?: AssertionOptions): void;
  last(report: SessionReport, matcher: Matcher, options?: AssertionOptions): void;
}

export interface ToolCallAssertions {
  has(report: SessionReport, matcher: ToolCallMatcher, options?: AssertionOptions): void;
  count(report: SessionReport, matcher: ToolCallMatcher, expected: number, options?: AssertionOptions): void;
  atLeast(report: SessionReport, matcher: ToolCallMatcher, min: number, options?: AssertionOptions): void;
  atMost(report: SessionReport, matcher: ToolCallMatcher, max: number, options?: AssertionOptions): void;
  before(
    report: SessionReport,
    firstMatcher: ToolCallMatcher,
    secondMatcher: ToolCallMatcher,
    options?: AssertionOptions,
  ): void;
  sequence(report: SessionReport, matchers: readonly ToolCallMatcher[], options?: AssertionOptions): void;
  only(report: SessionReport, matchers: readonly ToolCallMatcher[], options?: AssertionOptions): void;
}

export interface OutputAssertions {
  includes(report: SessionReport, matcher: Matcher, options?: AssertionOptions): void;
  notEmpty(report: SessionReport, options?: AssertionOptions): void;
}

export type SkillGymAssert = typeof nodeAssert & {
  skills: SkillAssertions;
  commands: CommandAssertions;
  fileReads: FileReadAssertions;
  toolCalls: ToolCallAssertions;
  output: OutputAssertions;
};
