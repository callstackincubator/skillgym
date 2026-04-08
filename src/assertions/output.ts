import { assertIncludes, composeAssertionMessage } from "./matchers.ts";
import type { OutputAssertions } from "./types.ts";

export const outputAssertions: OutputAssertions = {
  includes(report, matcher, options) {
    assertIncludes("final output", [report.finalOutput], matcher, options);
  },
  notEmpty(report, options) {
    if (report.finalOutput.length > 0) {
      return;
    }

    throw new Error(
      composeAssertionMessage("Expected final output not to be empty.", "Observed final output: (empty)", options?.message),
    );
  },
};
