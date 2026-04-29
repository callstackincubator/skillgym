import {
  assertCommandAtLeast,
  assertCommandAtMost,
  assertCommandBefore,
  assertCommandCount,
  assertCommandFirst,
  assertCommandIncludes,
  assertCommandLast,
  assertCommandNotIncludes,
  assertCommandOnly,
} from "./command-matcher.js";
import { assertSize, getCommands } from "./matchers.js";
import type { CommandAssertions } from "./types.js";

export const commandAssertions: CommandAssertions = {
  includes(report, matcher, options) {
    assertCommandIncludes(getCommands(report), matcher, options);
  },
  notIncludes(report, matcher, options) {
    assertCommandNotIncludes(getCommands(report), matcher, options);
  },
  count(report, matcher, expected, options) {
    assertCommandCount(getCommands(report), matcher, expected, options);
  },
  atLeast(report, matcher, min, options) {
    assertCommandAtLeast(getCommands(report), matcher, min, options);
  },
  atMost(report, matcher, max, options) {
    assertCommandAtMost(getCommands(report), matcher, max, options);
  },
  before(report, firstMatcher, secondMatcher, options) {
    assertCommandBefore(getCommands(report), firstMatcher, secondMatcher, options);
  },
  only(report, matchers, options) {
    assertCommandOnly(getCommands(report), matchers, options);
  },
  size(report, expected, options) {
    assertSize("commands", getCommands(report), expected, options);
  },
  exactlyOne(report, matcher, options) {
    assertCommandCount(getCommands(report), matcher, 1, options);
  },
  first(report, matcher, options) {
    assertCommandFirst(getCommands(report), matcher, options);
  },
  last(report, matcher, options) {
    assertCommandLast(getCommands(report), matcher, options);
  },
};
