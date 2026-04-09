import nodeAssert from "node:assert/strict";
import { test } from "vitest";
import { assert } from "../../src/assertions/index.js";
import type { SessionEvent, SessionReport } from "../../src/domain/session-report.js";
import { createRunnerInfo } from "../../src/runner/runner-info.js";

test("commands includes support string and regex matchers", () => {
  const report = createReport([
    { type: "command", command: "npx skills find expo", at: "1" },
    { type: "command", command: "pnpm test", at: "2" },
  ]);

  assert.commands.includes(report, "skills find");
  assert.commands.includes(report, /^pnpm test$/);
});

test("commands count and atLeast track repeated matches", () => {
  const report = createReport([
    { type: "command", command: "pnpm test", at: "1" },
    { type: "command", command: "pnpm test", at: "2" },
    { type: "command", command: "pnpm build", at: "3" },
  ]);

  assert.commands.count(report, "pnpm test", 2);
  assert.commands.atLeast(report, /^pnpm/, 3);
  assert.commands.atMost(report, "pnpm test", 2);
  assert.commands.exactlyOne(report, "pnpm build");
  assert.commands.size(report, 3);
});

test("commands before uses first matching occurrences", () => {
  const report = createReport([
    { type: "command", command: "prepare workspace", at: "1" },
    { type: "command", command: "npx skills find expo", at: "2" },
    { type: "command", command: "pnpm install", at: "3" },
  ]);

  assert.commands.before(report, /skills find/, /pnpm install/);

  nodeAssert.throws(() => {
    assert.commands.before(report, /pnpm install/, /skills find/);
  }, /Found first match at index 2 and second match at index 1/);
});

test("commands notIncludes and missing matches show observed values", () => {
  const report = createReport([{ type: "command", command: "pnpm test", at: "1" }]);

  assert.commands.notIncludes(report, "npm install");

  nodeAssert.throws(() => {
    assert.commands.includes(report, "npm install");
  }, /Observed commands: pnpm test/);
});

test("commands only, first, and last validate command boundaries", () => {
  const report = createReport([
    { type: "command", command: "rozenite --help", at: "1" },
    { type: "command", command: "agent session create", at: "2" },
    { type: "command", command: "agent session stop", at: "3" },
  ]);

  assert.commands.only(report, [/rozenite --help/, /agent session create/, /agent session stop/]);
  assert.commands.first(report, /rozenite --help/);
  assert.commands.last(report, /agent session stop/);

  nodeAssert.throws(() => {
    assert.commands.only(report, [/agent session create/, /agent session stop/]);
  }, /Unexpected: rozenite --help/);
});

function createReport(events: SessionEvent[]): SessionReport {
  return {
    runner: createRunnerInfo("opencode", { type: "opencode", model: "openai/gpt-5" }),
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
    events,
    finalOutput: "",
    rawArtifacts: {},
  };
}
