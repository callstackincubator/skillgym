import nodeAssert from "node:assert/strict";
import { test } from "vitest";
import { assert } from "../../src/assertions/index.js";
import type { SessionEvent, SessionReport } from "../../src/domain/session-report.js";
import { createRunnerInfo } from "../../src/runner/runner-info.js";

test("toolCalls match by tool name and args predicate", () => {
  const report = createReport([
    { type: "toolCall", tool: "skill", args: { name: "rozenite-agent" }, at: "1" },
    { type: "toolCall", tool: "read", args: { filePath: "/tmp/mmkv.md" }, at: "2" },
    { type: "toolCall", tool: "bash", args: { command: "agent session create" }, at: "3" },
    { type: "toolCall", tool: "bash", args: { command: "agent session stop" }, at: "4" },
  ]);

  assert.toolCalls.has(report, {
    tool: "skill",
    where: (args) => (args as { name?: string })?.name === "rozenite-agent",
  });
  assert.toolCalls.count(report, { tool: "bash" }, 2);
  assert.toolCalls.atLeast(report, { tool: "bash" }, 2);
  assert.toolCalls.atMost(report, { tool: "skill" }, 1);
});

test("toolCalls before and sequence validate ordered tool usage", () => {
  const report = createReport([
    { type: "toolCall", tool: "skill", args: { name: "rozenite-agent" }, at: "1" },
    { type: "toolCall", tool: "read", args: { filePath: "/tmp/mmkv.md" }, at: "2" },
    { type: "toolCall", tool: "bash", args: { command: "agent session create" }, at: "3" },
    {
      type: "toolCall",
      tool: "bash",
      args: { command: "agent at-rozenite__mmkv-plugin call --tool list-storages" },
      at: "4",
    },
  ]);

  assert.toolCalls.before(report, { tool: "skill" }, { tool: "read" });
  assert.toolCalls.sequence(report, [
    { tool: "skill" },
    {
      tool: "read",
      where: (args) => /mmkv\.md$/.test((args as { filePath?: string })?.filePath ?? ""),
    },
    {
      tool: "bash",
      where: (args) => /session create/.test((args as { command?: string })?.command ?? ""),
    },
    {
      tool: "bash",
      where: (args) => /list-storages/.test((args as { command?: string })?.command ?? ""),
    },
  ]);

  nodeAssert.throws(() => {
    assert.toolCalls.sequence(report, [{ tool: "read" }, { tool: "skill" }]);
  }, /sequence/);
});

test("toolCalls only reports unexpected tool calls", () => {
  const report = createReport([
    { type: "toolCall", tool: "skill", args: { name: "rozenite-agent" }, at: "1" },
    { type: "toolCall", tool: "bash", args: { command: "agent session create" }, at: "2" },
    { type: "toolCall", tool: "glob", args: { pattern: "src/**/*" }, at: "3" },
  ]);

  nodeAssert.throws(() => {
    assert.toolCalls.only(report, [{ tool: "skill" }, { tool: "bash" }]);
  }, /Unexpected: glob/);
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
