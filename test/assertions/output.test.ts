import nodeAssert from "node:assert/strict";
import { test } from "vitest";
import { assert } from "../../src/assertions/index.ts";
import type { SessionReport } from "../../src/domain/session-report.ts";
import { createRunnerInfo } from "../../src/runner/runner-info.ts";

test("output includes and notEmpty validate final output", () => {
  const report = createReport("Found MMKV storages: user-storage, cache-storage");

  assert.output.includes(report, /MMKV storages/);
  assert.output.notEmpty(report);
});

test("output failures include empty output details", () => {
  const report = createReport("");

  nodeAssert.throws(() => {
    assert.output.notEmpty(report);
  }, /Observed final output: \(empty\)/);
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
