import type { SessionReport } from "../domain/session-report.js";
import {
  assertAtLeast,
  assertAtMost,
  assertBefore,
  assertCount,
  assertFirst,
  assertIncludes,
  assertLast,
  assertNotIncludes,
  assertOnly,
  assertSize,
  getCommands,
} from "./matchers.js";
import type { CommandAssertions } from "./types.js";

export const commandAssertions: CommandAssertions = {
  includes(report, matcher, options) {
    assertIncludes("commands", getCommands(report), matcher, options);
  },
  notIncludes(report, matcher, options) {
    assertNotIncludes("commands", getCommands(report), matcher, options);
  },
  count(report, matcher, expected, options) {
    assertCount("commands", getCommands(report), matcher, expected, options);
  },
  atLeast(report, matcher, min, options) {
    assertAtLeast("commands", getCommands(report), matcher, min, options);
  },
  atMost(report, matcher, max, options) {
    assertAtMost("commands", getCommands(report), matcher, max, options);
  },
  before(report, firstMatcher, secondMatcher, options) {
    assertBefore("commands", getCommands(report), firstMatcher, secondMatcher, options);
  },
  only(report, matchers, options) {
    assertOnly("commands", getCommands(report), matchers, options);
  },
  size(report, expected, options) {
    assertSize("commands", getCommands(report), expected, options);
  },
  exactlyOne(report, matcher, options) {
    assertCount("commands", getCommands(report), matcher, 1, options);
  },
  first(report, matcher, options) {
    assertFirst("commands", getCommands(report), matcher, options);
  },
  last(report, matcher, options) {
    assertLast("commands", getCommands(report), matcher, options);
  },
};
