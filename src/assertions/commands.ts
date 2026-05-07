import {
  assertCommandAtLeast,
  assertCommandAtMost,
  assertCommandBefore,
  assertCommandCount,
  countCommandMatches,
  assertCommandFirst,
  assertCommandIncludes,
  assertCommandLast,
  assertCommandNotIncludes,
  assertCommandOnly,
  describeCommandMatcher,
} from "./command-matcher.js";
import { captureExplainableAssertion } from "./explain.js";
import { assertSize, getCommands } from "./matchers.js";
import type { CommandAssertions } from "./types.js";

export const commandAssertions: CommandAssertions = {
  includes(report, matcher, options) {
    const commands = getCommands(report);
    captureExplainableAssertion(() => assertCommandIncludes(commands, matcher, options), {
      report,
      assertionOptions: options,
      expected: matcher,
      observed: commands,
      buildQuestion: () =>
        `You were expected to run a command matching ${describeCommandMatcher(matcher)}. Why did you not do that?`,
    });
  },
  notIncludes(report, matcher, options) {
    const commands = getCommands(report);
    captureExplainableAssertion(() => assertCommandNotIncludes(commands, matcher, options), {
      report,
      assertionOptions: options,
      expected: matcher,
      observed: commands,
      buildQuestion: () =>
        `You were expected not to run a command matching ${describeCommandMatcher(matcher)}. Why did you run it anyway?`,
    });
  },
  count(report, matcher, expected, options) {
    const commands = getCommands(report);
    const actual = countCommandMatches(commands, matcher);
    captureExplainableAssertion(() => assertCommandCount(commands, matcher, expected, options), {
      report,
      assertionOptions: options,
      expected,
      actual,
      observed: commands,
      buildQuestion: () =>
        `You were expected to run ${expected} command(s) matching ${describeCommandMatcher(matcher)}. Why did your command choices differ?`,
    });
  },
  atLeast(report, matcher, min, options) {
    const commands = getCommands(report);
    const actual = countCommandMatches(commands, matcher);
    captureExplainableAssertion(() => assertCommandAtLeast(commands, matcher, min, options), {
      report,
      assertionOptions: options,
      expected: min,
      actual,
      observed: commands,
      buildQuestion: () =>
        `You were expected to run at least ${min} command(s) matching ${describeCommandMatcher(matcher)}. Why did you run fewer?`,
    });
  },
  atMost(report, matcher, max, options) {
    const commands = getCommands(report);
    const actual = countCommandMatches(commands, matcher);
    captureExplainableAssertion(() => assertCommandAtMost(commands, matcher, max, options), {
      report,
      assertionOptions: options,
      expected: max,
      actual,
      observed: commands,
      buildQuestion: () =>
        `You were expected to run at most ${max} command(s) matching ${describeCommandMatcher(matcher)}. Why did you run more?`,
    });
  },
  before(report, firstMatcher, secondMatcher, options) {
    const commands = getCommands(report);
    captureExplainableAssertion(
      () => assertCommandBefore(commands, firstMatcher, secondMatcher, options),
      {
        report,
        assertionOptions: options,
        expected: [firstMatcher, secondMatcher],
        observed: commands,
        buildQuestion: () =>
          `You were expected to run a command matching ${describeCommandMatcher(firstMatcher)} before ${describeCommandMatcher(secondMatcher)}. Why did you choose a different order?`,
      },
    );
  },
  only(report, matchers, options) {
    const commands = getCommands(report);
    captureExplainableAssertion(() => assertCommandOnly(commands, matchers, options), {
      report,
      assertionOptions: options,
      expected: matchers,
      observed: commands,
      buildQuestion: () =>
        `You were expected to run only commands matching one of: ${matchers.map(describeCommandMatcher).join(", ") || "(none)"}. Why did you choose a different command set?`,
    });
  },
  size(report, expected, options) {
    const commands = getCommands(report);
    captureExplainableAssertion(() => assertSize("commands", commands, expected, options), {
      report,
      assertionOptions: options,
      expected,
      actual: commands.length,
      observed: commands,
      buildQuestion: () =>
        `You were expected to run exactly ${expected} command(s), but ran ${commands.length}. Why?`,
    });
  },
  exactlyOne(report, matcher, options) {
    const commands = getCommands(report);
    const actual = countCommandMatches(commands, matcher);
    captureExplainableAssertion(() => assertCommandCount(commands, matcher, 1, options), {
      report,
      assertionOptions: options,
      expected: 1,
      actual,
      observed: commands,
      buildQuestion: () =>
        `You were expected to run exactly one command matching ${describeCommandMatcher(matcher)}. Why did you not do that?`,
    });
  },
  first(report, matcher, options) {
    const commands = getCommands(report);
    captureExplainableAssertion(() => assertCommandFirst(commands, matcher, options), {
      report,
      assertionOptions: options,
      expected: matcher,
      observed: commands,
      buildQuestion: () =>
        `You were expected to make your first command match ${describeCommandMatcher(matcher)}. Why did you choose a different first step?`,
    });
  },
  last(report, matcher, options) {
    const commands = getCommands(report);
    captureExplainableAssertion(() => assertCommandLast(commands, matcher, options), {
      report,
      assertionOptions: options,
      expected: matcher,
      observed: commands,
      buildQuestion: () =>
        `You were expected to make your last command match ${describeCommandMatcher(matcher)}. Why did you choose a different final command?`,
    });
  },
};
