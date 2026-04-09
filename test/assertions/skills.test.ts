import nodeAssert from "node:assert/strict";
import { test } from "vitest";
import { assert } from "../../src/assertions/index.js";
import type { SessionReport } from "../../src/domain/session-report.js";
import { createRunnerInfo } from "../../src/runner/runner-info.js";

test("package root exports library assert without executing CLI", () => {
  nodeAssert.equal(typeof assert, "function");
  nodeAssert.equal(typeof assert.skills.has, "function");
});

test("skills.has and includes accept matching skills", () => {
  const report = createReport({
    detectedSkills: [
      { skill: "find-skills", confidence: "strong", evidence: ["prompt"] },
      { skill: "upgrading-expo", confidence: "medium", evidence: ["path"] },
    ],
  });

  assert.skills.has(report, "find-skills");
  assert.skills.includes(report, ["find-skills", "upgrading-expo"]);
  assert.skills.count(report, "find-skills", 1);
  assert.skills.exactlyOne(report, "upgrading-expo");
  assert.skills.only(report, ["find-skills", "upgrading-expo"]);
});

test("skills respect minimum confidence", () => {
  const report = createReport({
    detectedSkills: [{ skill: "find-skills", confidence: "medium", evidence: ["path"] }],
  });

  assert.skills.has(report, "find-skills", { minConfidence: "medium" });

  nodeAssert.throws(() => {
    assert.skills.has(report, "find-skills", { minConfidence: "strong" });
  }, /minimum confidence strong/);
});

test("skills.notHas fails with clear observed values", () => {
  const report = createReport({
    detectedSkills: [{ skill: "find-skills", confidence: "explicit", evidence: ["tool"] }],
  });

  nodeAssert.throws(() => {
    assert.skills.notHas(report, "find-skills");
  }, /Observed detectedSkills: find-skills \(explicit\)/);
});

test("skills.includes reports all missing skills", () => {
  const report = createReport({
    detectedSkills: [{ skill: "find-skills", confidence: "strong", evidence: ["tool"] }],
  });

  nodeAssert.throws(() => {
    assert.skills.includes(report, ["find-skills", "upgrading-expo"]);
  }, /Missing: "upgrading-expo"/);
});

test("skills.only reports unexpected skills", () => {
  const report = createReport({
    detectedSkills: [
      { skill: "find-skills", confidence: "strong", evidence: ["tool"] },
      { skill: "upgrading-expo", confidence: "medium", evidence: ["path"] },
    ],
  });

  nodeAssert.throws(() => {
    assert.skills.only(report, ["find-skills"]);
  }, /Unexpected: upgrading-expo \(medium\)/);
});

function createReport(overrides: Partial<SessionReport> = {}): SessionReport {
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
    finalOutput: "",
    rawArtifacts: {},
    ...overrides,
  };
}
