import type { SessionReport } from "../domain/session-report.ts";
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
  getFileReads,
} from "./matchers.ts";
import type { FileReadAssertions } from "./types.ts";

export const fileReadAssertions: FileReadAssertions = {
  includes(report, matcher, options) {
    assertIncludes("file reads", getFileReads(report), matcher, options);
  },
  notIncludes(report, matcher, options) {
    assertNotIncludes("file reads", getFileReads(report), matcher, options);
  },
  count(report, matcher, expected, options) {
    assertCount("file reads", getFileReads(report), matcher, expected, options);
  },
  atLeast(report, matcher, min, options) {
    assertAtLeast("file reads", getFileReads(report), matcher, min, options);
  },
  atMost(report, matcher, max, options) {
    assertAtMost("file reads", getFileReads(report), matcher, max, options);
  },
  before(report, firstMatcher, secondMatcher, options) {
    assertBefore("file reads", getFileReads(report), firstMatcher, secondMatcher, options);
  },
  only(report, matchers, options) {
    assertOnly("file reads", getFileReads(report), matchers, options);
  },
  size(report, expected, options) {
    assertSize("file reads", getFileReads(report), expected, options);
  },
  exactlyOne(report, matcher, options) {
    assertCount("file reads", getFileReads(report), matcher, 1, options);
  },
  first(report, matcher, options) {
    assertFirst("file reads", getFileReads(report), matcher, options);
  },
  last(report, matcher, options) {
    assertLast("file reads", getFileReads(report), matcher, options);
  },
};
