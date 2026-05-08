import type { SessionReport } from "../domain/session-report.js";
import { captureExplainableAssertion } from "./explain.js";
import {
  assertToolCallAtLeast,
  assertToolCallAtMost,
  assertToolCallBefore,
  assertToolCallCount,
  countToolCallMatches,
  assertToolCallHas,
  assertToolCallOnly,
  assertToolCallSequence,
  describeToolCallMatcher,
  getToolCalls,
} from "./matchers.js";
import type { ToolCallAssertions } from "./types.js";

export const toolCallAssertions: ToolCallAssertions = {
  has(report, matcher, options) {
    const toolCalls = getToolCalls(report);
    captureExplainableAssertion(() => assertToolCallHas(toolCalls, matcher, options), {
      report,
      assertionOptions: options,
      expected: matcher,
      observed: toolCalls,
      buildQuestion: () =>
        `You were expected to make a tool call matching ${describeToolCallMatcher(matcher)}. Why did you not do that?`,
    });
  },
  count(report, matcher, expected, options) {
    const toolCalls = getToolCalls(report);
    const actual = countToolCallMatches(toolCalls, matcher);
    captureExplainableAssertion(() => assertToolCallCount(toolCalls, matcher, expected, options), {
      report,
      assertionOptions: options,
      expected,
      actual,
      observed: toolCalls,
      buildQuestion: () =>
        `You were expected to make ${expected} tool call(s) matching ${describeToolCallMatcher(matcher)}. Why did your tool choices differ?`,
    });
  },
  atLeast(report, matcher, min, options) {
    const toolCalls = getToolCalls(report);
    const actual = countToolCallMatches(toolCalls, matcher);
    captureExplainableAssertion(() => assertToolCallAtLeast(toolCalls, matcher, min, options), {
      report,
      assertionOptions: options,
      expected: min,
      actual,
      observed: toolCalls,
      buildQuestion: () =>
        `You were expected to make at least ${min} tool call(s) matching ${describeToolCallMatcher(matcher)}. Why did you make fewer?`,
    });
  },
  atMost(report, matcher, max, options) {
    const toolCalls = getToolCalls(report);
    const actual = countToolCallMatches(toolCalls, matcher);
    captureExplainableAssertion(() => assertToolCallAtMost(toolCalls, matcher, max, options), {
      report,
      assertionOptions: options,
      expected: max,
      actual,
      observed: toolCalls,
      buildQuestion: () =>
        `You were expected to make at most ${max} tool call(s) matching ${describeToolCallMatcher(matcher)}. Why did you make more?`,
    });
  },
  before(report, firstMatcher, secondMatcher, options) {
    const toolCalls = getToolCalls(report);
    captureExplainableAssertion(
      () => assertToolCallBefore(toolCalls, firstMatcher, secondMatcher, options),
      {
        report,
        assertionOptions: options,
        expected: [firstMatcher, secondMatcher],
        observed: toolCalls,
        buildQuestion: () =>
          `You were expected to make a tool call matching ${describeToolCallMatcher(firstMatcher)} before ${describeToolCallMatcher(secondMatcher)}. Why did you choose a different order?`,
      },
    );
  },
  sequence(report, matchers, options) {
    const toolCalls = getToolCalls(report);
    captureExplainableAssertion(() => assertToolCallSequence(toolCalls, matchers, options), {
      report,
      assertionOptions: options,
      expected: matchers,
      observed: toolCalls,
      buildQuestion: () =>
        `You were expected to follow this tool call sequence: ${matchers.map(describeToolCallMatcher).join(" -> ")}. Why did you choose a different sequence?`,
    });
  },
  only(report, matchers, options) {
    const toolCalls = getToolCalls(report);
    captureExplainableAssertion(() => assertToolCallOnly(toolCalls, matchers, options), {
      report,
      assertionOptions: options,
      expected: matchers,
      observed: toolCalls,
      buildQuestion: () =>
        `You were expected to make only tool calls matching one of: ${matchers.map(describeToolCallMatcher).join(", ") || "(none)"}. Why did you choose different tools?`,
    });
  },
};
