import type { SessionReport } from "../domain/session-report.js";
import { captureExplainableAssertion } from "./explain.js";
import {
  assertAtLeast,
  assertAtMost,
  assertBefore,
  assertCount,
  countMatches,
  assertFirst,
  assertIncludes,
  assertLast,
  assertNotIncludes,
  assertOnly,
  assertSize,
  getFileReads,
  describeMatcher,
} from "./matchers.js";
import type { FileReadAssertions } from "./types.js";

export const fileReadAssertions: FileReadAssertions = {
  includes(report, matcher, options) {
    const fileReads = getFileReads(report);
    captureExplainableAssertion(() => assertIncludes("file reads", fileReads, matcher, options), {
      report,
      assertionOptions: options,
      expected: matcher,
      observed: fileReads,
      buildQuestion: () =>
        `You were expected to read a file matching ${describeMatcher(matcher)}. Why did you not read it?`,
    });
  },
  notIncludes(report, matcher, options) {
    const fileReads = getFileReads(report);
    captureExplainableAssertion(
      () => assertNotIncludes("file reads", fileReads, matcher, options),
      {
        report,
        assertionOptions: options,
        expected: matcher,
        observed: fileReads,
        buildQuestion: () =>
          `You were expected not to read a file matching ${describeMatcher(matcher)}. Why did you read it anyway?`,
      },
    );
  },
  count(report, matcher, expected, options) {
    const fileReads = getFileReads(report);
    const actual = countMatches(fileReads, matcher);
    captureExplainableAssertion(
      () => assertCount("file reads", fileReads, matcher, expected, options),
      {
        report,
        assertionOptions: options,
        expected,
        actual,
        observed: fileReads,
        buildQuestion: () =>
          `You were expected to read ${expected} file(s) matching ${describeMatcher(matcher)}. Why did your reads differ?`,
      },
    );
  },
  atLeast(report, matcher, min, options) {
    const fileReads = getFileReads(report);
    const actual = countMatches(fileReads, matcher);
    captureExplainableAssertion(
      () => assertAtLeast("file reads", fileReads, matcher, min, options),
      {
        report,
        assertionOptions: options,
        expected: min,
        actual,
        observed: fileReads,
        buildQuestion: () =>
          `You were expected to read at least ${min} file(s) matching ${describeMatcher(matcher)}. Why did you read fewer?`,
      },
    );
  },
  atMost(report, matcher, max, options) {
    const fileReads = getFileReads(report);
    const actual = countMatches(fileReads, matcher);
    captureExplainableAssertion(
      () => assertAtMost("file reads", fileReads, matcher, max, options),
      {
        report,
        assertionOptions: options,
        expected: max,
        actual,
        observed: fileReads,
        buildQuestion: () =>
          `You were expected to read at most ${max} file(s) matching ${describeMatcher(matcher)}. Why did you read more?`,
      },
    );
  },
  before(report, firstMatcher, secondMatcher, options) {
    const fileReads = getFileReads(report);
    captureExplainableAssertion(
      () => assertBefore("file reads", fileReads, firstMatcher, secondMatcher, options),
      {
        report,
        assertionOptions: options,
        expected: [firstMatcher, secondMatcher],
        observed: fileReads,
        buildQuestion: () =>
          `You were expected to read a file matching ${describeMatcher(firstMatcher)} before ${describeMatcher(secondMatcher)}. Why did you choose a different order?`,
      },
    );
  },
  only(report, matchers, options) {
    const fileReads = getFileReads(report);
    captureExplainableAssertion(() => assertOnly("file reads", fileReads, matchers, options), {
      report,
      assertionOptions: options,
      expected: matchers,
      observed: fileReads,
      buildQuestion: () =>
        `You were expected to read only files matching one of: ${matchers.map(describeMatcher).join(", ") || "(none)"}. Why did you read different files?`,
    });
  },
  size(report, expected, options) {
    const fileReads = getFileReads(report);
    captureExplainableAssertion(() => assertSize("file reads", fileReads, expected, options), {
      report,
      assertionOptions: options,
      expected,
      actual: fileReads.length,
      observed: fileReads,
      buildQuestion: () =>
        `You were expected to read exactly ${expected} file(s), but read ${fileReads.length}. Why?`,
    });
  },
  exactlyOne(report, matcher, options) {
    const fileReads = getFileReads(report);
    const actual = countMatches(fileReads, matcher);
    captureExplainableAssertion(() => assertCount("file reads", fileReads, matcher, 1, options), {
      report,
      assertionOptions: options,
      expected: 1,
      actual,
      observed: fileReads,
      buildQuestion: () =>
        `You were expected to read exactly one file matching ${describeMatcher(matcher)}. Why did you not do that?`,
    });
  },
  first(report, matcher, options) {
    const fileReads = getFileReads(report);
    captureExplainableAssertion(() => assertFirst("file reads", fileReads, matcher, options), {
      report,
      assertionOptions: options,
      expected: matcher,
      observed: fileReads,
      buildQuestion: () =>
        `You were expected to make your first file read match ${describeMatcher(matcher)}. Why did you choose a different first read?`,
    });
  },
  last(report, matcher, options) {
    const fileReads = getFileReads(report);
    captureExplainableAssertion(() => assertLast("file reads", fileReads, matcher, options), {
      report,
      assertionOptions: options,
      expected: matcher,
      observed: fileReads,
      buildQuestion: () =>
        `You were expected to make your last file read match ${describeMatcher(matcher)}. Why did you choose a different final read?`,
    });
  },
};
