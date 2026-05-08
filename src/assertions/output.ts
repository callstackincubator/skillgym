import assert from "node:assert/strict";
import { captureExplainableAssertion } from "./explain.js";
import { assertIncludes, composeAssertionMessage } from "./matchers.js";
import type { OutputAssertions } from "./types.js";

export const outputAssertions: OutputAssertions = {
  includes(report, matcher, options) {
    captureExplainableAssertion(
      () => assertIncludes("final output", [report.finalOutput], matcher, options),
      {
        report,
        assertionOptions: options,
        expected: matcher,
        observed: report.finalOutput,
      },
    );
  },
  notEmpty(report, options) {
    captureExplainableAssertion(
      () =>
        assert.ok(
          report.finalOutput.length > 0,
          composeAssertionMessage(
            "Expected final output not to be empty.",
            "Observed final output: (empty)",
            options?.message,
          ),
        ),
      {
        report,
        assertionOptions: options,
        expected: "non-empty output",
        actual: report.finalOutput,
        observed: report.finalOutput,
      },
    );
  },
};
