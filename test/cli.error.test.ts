import { expect, test } from "vitest";
import { formatCliError } from "../src/cli/error.js";
import { RunFailuresError } from "../src/cli/run.js";

test("formatCliError formats known errors through declarative rules", () => {
  const rendered = formatCliError(new Error("No runners matched the requested filter: open-main"));

  expect(rendered).toContain("Error: runner filter did not match anything");
  expect(rendered).toContain("No configured runner matches `open-main`.");
  expect(rendered).toContain("Check the runner id in `skillgym.config.*`.");
});

test("formatCliError falls back to a generic message for unknown errors", () => {
  const rendered = formatCliError(new Error("Unexpected adapter failure"));

  expect(rendered).toContain("Error: skillgym could not complete the run");
  expect(rendered).toContain("Unexpected adapter failure");
  expect(rendered).toContain("If this looks like a bug in skillgym");
});

test("formatCliError does not special-case completed suites with failed runs", () => {
  const rendered = formatCliError(new RunFailuresError());

  expect(rendered).toContain("Error: skillgym could not complete the run");
  expect(rendered).toContain("One or more runs failed.");
});
