# Assertions

`skillgym` exports a root `assert` object that combines:

- Node's `node:assert/strict` API
- grouped helpers for normalized session reports
- `assert.soft.*` for Jest/Vitest-style sync soft assertions

```ts
import { assert } from "skillgym";

assert.ok(true);
assert.equal(1, 1);
assert.match("skillgym ready", /ready/);
assert.soft.match("skillgym ready", /ready/);
```

## Report helper groups

- `assert.soft.*`
- `assert.skills.*`
- `assert.commands.*`
- `assert.fileReads.*`
- `assert.toolCalls.*`
- `assert.output.*`

## Soft assertions

`assert.soft` mirrors the sync assertion methods on the root `assert` export and the grouped SkillGym helpers.

- soft failures are collected in execution order
- the runner throws a single `AssertionError` after `testCase.assert(report, ctx)` completes
- if a hard `AssertionError` is thrown after soft failures were collected, the final failure includes both
- `assert.soft.rejects(...)` and `assert.soft.doesNotReject(...)` remain hard assertions in the first implementation

Example:

```ts
assert.soft.match(report.finalOutput, /ready/i);
assert.soft.commands.includes(report, "pnpm test");
assert.soft.output.notEmpty(report);
```

## Shared matcher types

Commands, file reads, and output use:

```ts
type Matcher = string | RegExp;
```

Tool calls use:

```ts
interface ToolCallMatcher {
  tool?: string | RegExp;
  where?: (args: unknown, event: ToolCallEvent) => boolean;
}
```

Common grouped assertion options:

```ts
interface AssertionOptions {
  message?: string;
}
```

Skill assertions also accept:

```ts
type SkillConfidence = "weak" | "medium" | "strong" | "explicit";

interface SkillAssertionOptions {
  minConfidence?: SkillConfidence;
  message?: string;
}
```

## Skills

Skill assertions operate on `report.detectedSkills`.

Available methods:

- `assert.skills.has(report, skill, options?)`
- `assert.skills.notHas(report, skill, options?)`
- `assert.skills.includes(report, skills, options?)`
- `assert.skills.count(report, skill, expected, options?)`
- `assert.skills.exactlyOne(report, skill, options?)`
- `assert.skills.only(report, skills, options?)`

Descriptions:

- `has`: requires the named skill to be detected
- `notHas`: requires the named skill not to be detected
- `includes`: requires all listed skills to be detected
- `count`: requires the named skill to appear exactly `expected` times
- `exactlyOne`: alias for `count(..., 1)`
- `only`: requires every detected skill to be in the allowed list

Confidence behavior:

- `minConfidence` filters matches to detections at or above that confidence
- confidence order is `weak < medium < strong < explicit`

Example:

```ts
assert.skills.has(report, "find-skills");
assert.skills.has(report, "find-skills", { minConfidence: "strong" });
assert.skills.notHas(report, "upgrading-expo");
assert.skills.includes(report, ["find-skills", "upgrading-expo"]);
assert.skills.only(report, ["find-skills", "upgrading-expo"]);
```

## Commands

Command assertions operate on observed command events in execution order.

Use raw string or `RegExp` matchers when you only care about the emitted command text. Use `commandMatcher(...)` when you want stable checks against the executable, positional arguments, options, repeated flags, or `--` handling.

Available methods:

- `assert.commands.includes(report, matcher, options?)`
- `assert.commands.notIncludes(report, matcher, options?)`
- `assert.commands.count(report, matcher, expected, options?)`
- `assert.commands.atLeast(report, matcher, min, options?)`
- `assert.commands.atMost(report, matcher, max, options?)`
- `assert.commands.before(report, firstMatcher, secondMatcher, options?)`
- `assert.commands.only(report, matchers, options?)`
- `assert.commands.size(report, expected, options?)`
- `assert.commands.exactlyOne(report, matcher, options?)`
- `assert.commands.first(report, matcher, options?)`
- `assert.commands.last(report, matcher, options?)`

Descriptions:

- `includes`: requires at least one command matching the matcher
- `notIncludes`: requires no matching command
- `count`: requires exactly `expected` matching commands
- `atLeast`: requires at least `min` matching commands
- `atMost`: requires at most `max` matching commands
- `before`: requires the first match of `firstMatcher` to appear before the first match of `secondMatcher`
- `only`: requires every observed command to match one of the allowed matchers
- `size`: checks the total number of observed commands
- `exactlyOne`: alias for `count(..., 1)`
- `first`: checks the first observed command
- `last`: checks the last observed command

Example:

```ts
import { assert, commandMatcher } from "skillgym";

assert.commands.includes(report, "npx skills find");
assert.commands.notIncludes(report, "npm install");
assert.commands.count(report, /pnpm test/, 2);
assert.commands.before(report, /skills find/, /pnpm install/);
assert.commands.includes(
  report,
  commandMatcher("pnpm").arg("test").option("--filter", "unit").flag("--watch"),
);
assert.commands.first(report, /rozenite --help/);
assert.commands.last(report, /agent session stop/);
```

Structured command matcher semantics:

- string and `RegExp` command matchers keep the current raw-text behavior
- `executable` matches the leading command token
- positional arguments preserve order
- option order is ignored
- grouped short flags such as `-abc` are normalized as `-a`, `-b`, and `-c`
- option values from `--name value`, `--name=value`, and short attached forms such as `-p80` are normalized to the same matcher model
- bare `--` ends option parsing, and later tokens are treated as positional arguments
- `includes`, `count`, `before`, `first`, and `last` allow extra options and extra positionals unless the matcher uses `strict: true`, `exact: true`, or `.strict()` / `.exact()` on the builder

Normalization is best-effort. Some runners emit direct command strings, while others reconstruct commands from shell-wrapped output. Assertion failures show both the raw command and the parsed interpretation used for matching.

## File reads

File read assertions operate on observed file-read paths in execution order.

Available methods:

- `assert.fileReads.includes(report, matcher, options?)`
- `assert.fileReads.notIncludes(report, matcher, options?)`
- `assert.fileReads.count(report, matcher, expected, options?)`
- `assert.fileReads.atLeast(report, matcher, min, options?)`
- `assert.fileReads.atMost(report, matcher, max, options?)`
- `assert.fileReads.before(report, firstMatcher, secondMatcher, options?)`
- `assert.fileReads.only(report, matchers, options?)`
- `assert.fileReads.size(report, expected, options?)`
- `assert.fileReads.exactlyOne(report, matcher, options?)`
- `assert.fileReads.first(report, matcher, options?)`
- `assert.fileReads.last(report, matcher, options?)`

Descriptions:

- `includes`: requires at least one matching file read
- `notIncludes`: requires no matching file read
- `count`: requires exactly `expected` matches
- `atLeast`: requires at least `min` matches
- `atMost`: requires at most `max` matches
- `before`: requires the first match of `firstMatcher` to appear before the first match of `secondMatcher`
- `only`: requires every observed file read to match one of the allowed matchers
- `size`: checks the total number of observed file reads
- `exactlyOne`: alias for `count(..., 1)`
- `first`: checks the first observed file read
- `last`: checks the last observed file read

If file-read events are absent, these assertions can fall back to `report.files.observedReads`.

Example:

```ts
assert.fileReads.includes(report, /find-skills\/SKILL\.md$/);
assert.fileReads.notIncludes(report, /upgrading-expo\/SKILL\.md$/);
assert.fileReads.before(report, /find-skills\/SKILL\.md$/, /upgrading-expo\/SKILL\.md$/);
assert.fileReads.only(report, [/find-skills\/SKILL\.md$/, /upgrading-expo\/SKILL\.md$/]);
```

## Tool calls

Tool call assertions operate on observed tool-call events in execution order.

Available methods:

- `assert.toolCalls.has(report, matcher, options?)`
- `assert.toolCalls.count(report, matcher, expected, options?)`
- `assert.toolCalls.atLeast(report, matcher, min, options?)`
- `assert.toolCalls.atMost(report, matcher, max, options?)`
- `assert.toolCalls.before(report, firstMatcher, secondMatcher, options?)`
- `assert.toolCalls.sequence(report, matchers, options?)`
- `assert.toolCalls.only(report, matchers, options?)`

Descriptions:

- `has`: requires at least one matching tool call
- `count`: requires exactly `expected` matching tool calls
- `atLeast`: requires at least `min` matching tool calls
- `atMost`: requires at most `max` matching tool calls
- `before`: requires the first match of `firstMatcher` to appear before the first match of `secondMatcher`
- `sequence`: requires each matcher to appear after the previous one
- `only`: requires every observed tool call to match one of the allowed matchers

Example:

```ts
assert.toolCalls.has(report, {
  tool: "skill",
  where: (args) => (args as { name?: string })?.name === "rozenite-agent",
});

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
]);
```

## Output

Output assertions operate on `report.finalOutput`.

Available methods:

- `assert.output.includes(report, matcher, options?)`
- `assert.output.notEmpty(report, options?)`

Descriptions:

- `includes`: requires the final output to match a string or regex matcher
- `notEmpty`: requires non-empty final output

Example:

```ts
assert.output.includes(report, /MMKV storages/);
assert.output.notEmpty(report);
```

## Failure behavior

- if an assertion completes normally, it passes
- if it throws, it fails the current execution
- grouped assertion failures include observed values to help debug mismatches

## Related docs

- `test-cases.md`
- `session-report.md`
