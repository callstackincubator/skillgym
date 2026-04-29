import nodeAssert from "node:assert/strict";
import { test } from "vitest";
import { assert, commandMatcher } from "../../src/assertions/index.js";
import { parseCommand } from "../../src/assertions/command-matcher.js";
import type { SessionEvent, SessionReport } from "../../src/domain/session-report.js";
import { createRunnerInfo } from "../../src/runner/runner-info.js";

test("parseCommand normalizes flags, values, repeats, quotes, and end-of-options", () => {
  const parsed = parseCommand(
    'pnpm test --flag -f -abc -p80 --name=value --name two --tag beta --tag latest -- "two words" --literal',
  );

  nodeAssert.equal(parsed.executable, "pnpm");
  nodeAssert.deepEqual(parsed.positionals, ["test", "two words", "--literal"]);
  nodeAssert.equal(parsed.endOfOptions, true);
  nodeAssert.deepEqual(Object.fromEntries(parsed.options.entries()), {
    "--flag": [true],
    "-f": [true],
    "-a": [true],
    "-b": [true],
    "-c": [true],
    "-p": ["80"],
    "--name": ["value", "two"],
    "--tag": ["beta", "latest"],
  });
});

test("structured command matcher ignores option order by default", () => {
  const report = createReport([
    { type: "command", command: "pnpm --reporter dot test --filter unit", at: "1" },
  ]);

  assert.commands.includes(
    report,
    commandMatcher("pnpm").arg("test").option("--filter", "unit").option("--reporter", "dot"),
  );
});

test("structured command matcher preserves positional order", () => {
  const report = createReport([{ type: "command", command: "pnpm run build web", at: "1" }]);

  assert.commands.includes(report, commandMatcher("pnpm").args("run", "build"));

  nodeAssert.throws(() => {
    assert.commands.includes(report, commandMatcher("pnpm").args("build", "run"));
  }, /command matcher \(executable="pnpm", positionals=\["build", "run"\]\)/);
});

test("structured command matcher strict mode disallows extra options and positionals", () => {
  const report = createReport([{ type: "command", command: "pnpm test --watch", at: "1" }]);

  nodeAssert.throws(() => {
    assert.commands.includes(report, commandMatcher("pnpm").arg("test").strict());
  }, /strict=true/);

  assert.commands.includes(report, commandMatcher("pnpm").arg("test").flag("--watch").strict());
});

test("structured command matcher supports repeated options and shell-wrapped commands", () => {
  const report = createReport([
    {
      type: "command",
      command: 'bash -lc "pnpm publish --tag beta --tag latest -- dry run"',
      at: "1",
    },
  ]);

  assert.commands.includes(
    report,
    commandMatcher("pnpm")
      .arg("publish")
      .option("--tag", "beta")
      .option("--tag", "latest")
      .endOfOptions()
      .args("dry", "run"),
  );

  nodeAssert.throws(() => {
    assert.commands.includes(
      report,
      commandMatcher("pnpm").arg("publish").option("--tag", "stable"),
    );
  }, /normalized from shell wrapper/);
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
