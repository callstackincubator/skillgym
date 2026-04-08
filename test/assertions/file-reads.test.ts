import nodeAssert from "node:assert/strict";
import { test } from "vitest";
import { assert } from "../../src/assertions/index.ts";
import type { SessionEvent, SessionReport } from "../../src/domain/session-report.ts";
import { createRunnerInfo } from "../../src/runner/runner-info.ts";

test("fileReads includes support string and regex matchers", () => {
  const report = createReport({
    events: [
      { type: "fileRead", path: "/tmp/find-skills/SKILL.md", at: "1" },
      { type: "fileRead", path: "/tmp/upgrading-expo/SKILL.md", at: "2" },
    ],
  });

  assert.fileReads.includes(report, "find-skills/SKILL.md");
  assert.fileReads.includes(report, /upgrading-expo\/SKILL\.md$/);
});

test("fileReads count and atLeast work from fileRead events", () => {
  const report = createReport({
    events: [
      { type: "fileRead", path: "/tmp/find-skills/SKILL.md", at: "1" },
      { type: "fileRead", path: "/tmp/find-skills/SKILL.md", at: "2" },
      { type: "fileRead", path: "/tmp/upgrading-expo/SKILL.md", at: "3" },
    ],
  });

  assert.fileReads.count(report, /find-skills\/SKILL\.md$/, 2);
  assert.fileReads.atLeast(report, /SKILL\.md$/, 3);
  assert.fileReads.atMost(report, /find-skills\/SKILL\.md$/, 2);
  assert.fileReads.exactlyOne(report, /upgrading-expo\/SKILL\.md$/);
  assert.fileReads.size(report, 3);
});

test("fileReads before uses fallback observedReads when events are absent", () => {
  const report = createReport({
    files: {
      observedReads: ["/tmp/find-skills/SKILL.md", "/tmp/upgrading-expo/SKILL.md"],
      observedSkillReads: ["/tmp/find-skills/SKILL.md", "/tmp/upgrading-expo/SKILL.md"],
    },
  });

  assert.fileReads.before(report, /find-skills\/SKILL\.md$/, /upgrading-expo\/SKILL\.md$/);
});

test("fileReads failures include observed values", () => {
  const report = createReport({
    events: [{ type: "fileRead", path: "/tmp/find-skills/SKILL.md", at: "1" }],
  });

  assert.fileReads.notIncludes(report, /upgrading-expo\/SKILL\.md$/);

  nodeAssert.throws(() => {
    assert.fileReads.includes(report, /upgrading-expo\/SKILL\.md$/);
  }, /Observed file reads: \/tmp\/find-skills\/SKILL\.md/);
});

test("fileReads only, first, and last validate allowed paths", () => {
  const report = createReport({
    events: [
      { type: "fileRead", path: "/tmp/find-skills/SKILL.md", at: "1" },
      { type: "fileRead", path: "/tmp/upgrading-expo/SKILL.md", at: "2" },
    ],
  });

  assert.fileReads.only(report, [/find-skills\/SKILL\.md$/, /upgrading-expo\/SKILL\.md$/]);
  assert.fileReads.first(report, /find-skills\/SKILL\.md$/);
  assert.fileReads.last(report, /upgrading-expo\/SKILL\.md$/);

  nodeAssert.throws(() => {
    assert.fileReads.only(report, [/find-skills\/SKILL\.md$/]);
  }, /Unexpected: \/tmp\/upgrading-expo\/SKILL\.md/);
});

function createReport(overrides: Partial<SessionReport>): SessionReport {
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
    events: [] as SessionEvent[],
    finalOutput: "",
    rawArtifacts: {},
    ...overrides,
  };
}
