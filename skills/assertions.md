---
name: assertions
description: Assertion authoring for Skillgym benchmark suites. Covers hard and soft assertions, grouped helpers, skill detection checks, command matching, and failure classification.
---

# skillgym assertions

Use this skill when you are writing or debugging `assert(report, ctx)` logic.

## What Skillgym gives you

`skillgym` exports a root `assert` object that combines Node strict assertions with benchmark-focused helpers.

Available groups:

- `assert.soft.*`
- `assert.skills.*`
- `assert.commands.*`
- `assert.fileReads.*`
- `assert.toolCalls.*`
- `assert.output.*`

## Typical patterns

```ts
import { assert, commandMatcher } from "skillgym";

assert.skills.has(report, "find-skills");
assert.commands.includes(report, commandMatcher("pnpm").arg("test"));
assert.fileReads.includes(report, /README\.md$/);
assert.toolCalls.includes(report, { tool: /skill/i });
assert.match(ctx.finalOutput(), /expo/i);
```

## Hard vs soft assertions

- Use hard assertions when one failure should stop the case immediately.
- Use `assert.soft.*` when you want one run to report multiple mismatches together.

```ts
assert.soft.skills.has(report, "find-skills");
assert.soft.commands.includes(report, "npx skills find");
assert.soft.output.notEmpty(report);
```

## Skill assertions

Use `assert.skills.*` against `report.detectedSkills`.

Most useful methods:

- `has`
- `notHas`
- `includes`
- `count`
- `exactlyOne`
- `only`

Confidence can be filtered with `minConfidence`:

```ts
assert.skills.has(report, "find-skills", { minConfidence: "strong" });
```

## Command assertions

Use raw strings or `RegExp` for quick checks. Use `commandMatcher(...)` for stable matching on executable, args, and options.

```ts
assert.commands.includes(report, "pnpm test");
assert.commands.before(report, /skills find/, /pnpm install/);
assert.commands.includes(report, commandMatcher("pnpm").arg("test").option("--filter", "unit"));
```

## Output assertions

Use output assertions when the final agent response matters directly. Use them together with normalized report assertions, not instead of them.

## Failure classification

Use `assert.classify(...)` when multiple failures should collapse into one stable machine-readable cause.

```ts
assert.classify({ id: "wrong-cli-alias", label: "Wrong CLI alias" }, () => {
  assert.doesNotMatch(ctx.finalOutput(), /\bcursr\b/i);
});
```

This improves grouped reporting across runs.

## Good assertion style

- assert the smallest behavior that proves the benchmark intent
- prefer normalized report fields over fragile prose matching
- use command and tool-call assertions for workflow checks
- use output assertions for user-visible wording checks
- classify repeated failure modes with stable ids
