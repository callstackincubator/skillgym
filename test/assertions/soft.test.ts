import nodeAssert, { AssertionError } from "node:assert/strict";
import { test } from "vitest";
import { assert, runWithSoftAssertions } from "../../src/assertions/index.js";
import type { SessionReport } from "../../src/domain/session-report.js";
import { createRunnerInfo } from "../../src/runner/runner-info.js";

test("assert.soft collects multiple Node assertion failures", async () => {
  await nodeAssert.rejects(
    () =>
      runWithSoftAssertions(() => {
        assert.soft.equal(1, 2, "first soft failure");
        assert.soft.match("skillgym ready", /failed/, "second soft failure");
      }),
    (error) => {
      nodeAssert.ok(error instanceof AssertionError);
      nodeAssert.match(
        error.message,
        /2 assertion failures collected during test case execution:/,
      );
      nodeAssert.match(error.message, /1\. first soft failure/);
      nodeAssert.match(error.message, /2\. second soft failure/);
      return true;
    },
  );
});

test("assert.soft collects grouped helper failures", async () => {
  const report = createReport("");

  await nodeAssert.rejects(
    () =>
      runWithSoftAssertions(() => {
        assert.soft.output.notEmpty(report, { message: "expected output" });
        assert.soft.commands.includes(report, "pnpm test", { message: "expected command" });
      }),
    (error) => {
      nodeAssert.ok(error instanceof AssertionError);
      nodeAssert.match(error.message, /expected output/);
      nodeAssert.match(error.message, /expected command/);
      return true;
    },
  );
});

function createReport(finalOutput: string): SessionReport {
  return {
    runner: createRunnerInfo("codex", { type: "codex", model: "gpt-5" }),
    prompt: "test prompt",
    usage: {
      inputChars: 0,
      outputChars: 0,
      reasoningChars: 0,
      source: {
        input: "chars",
        output: "chars",
        reasoning: "chars",
      },
    },
    files: {
      observedReads: [],
      observedSkillReads: [],
    },
    detectedSkills: [],
    events: [],
    finalOutput,
    rawArtifacts: {},
  };
}
