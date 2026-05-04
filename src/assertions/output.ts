import assert from "node:assert/strict";
import { assertIncludes, composeAssertionMessage } from "./matchers.js";
import type { OutputAssertions } from "./types.js";

export const outputAssertions: OutputAssertions = {
  includes(report, matcher, options) {
    assertIncludes("final output", [report.finalOutput], matcher, options);
  },
  notEmpty(report, options) {
    assert.ok(
      report.finalOutput.length > 0,
      composeAssertionMessage(
        "Expected final output not to be empty.",
        "Observed final output: (empty)",
        options?.message,
      ),
    );
  },
};
