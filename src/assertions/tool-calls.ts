import type { SessionReport } from "../domain/session-report.ts";
import {
  assertToolCallAtLeast,
  assertToolCallAtMost,
  assertToolCallBefore,
  assertToolCallCount,
  assertToolCallHas,
  assertToolCallOnly,
  assertToolCallSequence,
  getToolCalls,
} from "./matchers.ts";
import type { ToolCallAssertions } from "./types.ts";

export const toolCallAssertions: ToolCallAssertions = {
  has(report, matcher, options) {
    assertToolCallHas(getToolCalls(report), matcher, options);
  },
  count(report, matcher, expected, options) {
    assertToolCallCount(getToolCalls(report), matcher, expected, options);
  },
  atLeast(report, matcher, min, options) {
    assertToolCallAtLeast(getToolCalls(report), matcher, min, options);
  },
  atMost(report, matcher, max, options) {
    assertToolCallAtMost(getToolCalls(report), matcher, max, options);
  },
  before(report, firstMatcher, secondMatcher, options) {
    assertToolCallBefore(getToolCalls(report), firstMatcher, secondMatcher, options);
  },
  sequence(report, matchers, options) {
    assertToolCallSequence(getToolCalls(report), matchers, options);
  },
  only(report, matchers, options) {
    assertToolCallOnly(getToolCalls(report), matchers, options);
  },
};
