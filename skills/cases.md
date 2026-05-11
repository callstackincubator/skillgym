---
name: cases
description: Defining Skillgym suites and cases. Covers suite exports, case fields, tags, expected failures, timeouts, and assertion context usage.
---

# skillgym cases

Use this skill when creating or restructuring suite files.

## Suite exports

A suite module must export a default suite value.

Supported shapes:

- array of `Case`
- object map of named `Case`

```ts
import { assert, type Case } from "skillgym";

const suite: Case[] = [
  {
    id: "always-passes",
    prompt: "Say only: skillgym ready",
    assert(report, ctx) {
      assert.match(ctx.finalOutput(), /skillgym ready/);
    },
  },
];

export default suite;
```

## Important fields

- `id`: stable identifier used in results and artifact paths
- `prompt`: exact prompt sent to the runner
- `tags`: optional labels for `--tag`
- `timeoutMs`: per-case timeout override
- `expectedFail`: mark assertion failures as expected benchmark signal
- `classifyFailure(result)`: assign or override a structured failure class
- `assert(report, ctx)`: pass/fail logic

## Tags

Tags let you run slices of a suite without changing file structure.

```bash
skillgym run ./suite.ts --tag smoke
skillgym run ./suite.ts --tag smoke,auth
skillgym run ./suite.ts --tag smoke --tag auth
```

Tag matching is OR-based.

## Expected failures

Use `expectedFail: true` for known model or agent gaps that you want to track without failing the suite.

- assertion failure becomes `expected-failed`
- assertion success becomes `unexpected-passed`
- infrastructure failures still fail the suite

## Assertion context

`ctx` is a convenience wrapper over the session report.

Useful helpers:

- `ctx.getCommands()`
- `ctx.getToolCalls(tool?)`
- `ctx.getFileReads()`
- `ctx.detectedSkills()`
- `ctx.finalOutput()`

## Recommended case shape

- one benchmark intent per case
- one stable prompt per case
- assertions that prove the intent directly
- tags only when they improve filtering

Keep cases small and composable. If a case is checking multiple unrelated things, split it.
