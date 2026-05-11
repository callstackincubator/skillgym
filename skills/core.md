---
name: core
description: Core Skillgym workflow for agents. Read this first before writing or debugging suites. Covers how to structure a suite, run it, interpret results, and when to read deeper feature-specific skills.
---

# skillgym core

Skillgym benchmarks coding-agent behavior by running real agent sessions and asserting on the normalized execution report.

Read this skill first. It gives you the default workflow, the minimum suite shape, and the map to deeper feature skills.

## Core loop

```bash
skillgym skills get core
skillgym run <suite.ts>
skillgym run <suite.ts> --case <id>
skillgym run <suite.ts> --runner <runner-id>
```

Typical agent loop:

1. Read the target suite or create one.
2. Write or refine prompts and assertions.
3. Run one suite, case, or runner slice.
4. Inspect failures from the output directory and session report.
5. Tighten assertions or workspace mode, template, or bootstrap until the benchmark captures the intended behavior.

## Minimum suite shape

```ts
import { assert, type Case } from "skillgym";

const suite: Case[] = [
  {
    id: "uses-correct-skill",
    prompt: "Find the right skill and explain how to install it.",
    assert(report) {
      assert.skills.has(report, "find-skills");
      assert.match(report.finalOutput, /install/i);
    },
  },
];

export default suite;
```

Use stable `id` values. Keep prompts exact. Put benchmark intent in assertions, not in prose comments.

## Primary commands

```bash
skillgym help
skillgym skills list
skillgym skills get <name>

skillgym run <suite.ts>
skillgym run <suite.ts> --case <id>
skillgym run <suite.ts> --tag <tag>
skillgym run <suite.ts> --runner <runner-id>
skillgym run <suite.ts> --reporter json-summary
skillgym run <suite.ts> --schedule parallel --max-parallel 4
skillgym run <suite.ts> --update-snapshots
```

## Mental model

- A configured runner is one agent target.
- Each selected case runs once per selected runner.
- Assertions evaluate the session report after the execution finishes.
- Output artifacts are written under the configured `outputDir`.
- Expected assertion failures can be benchmark-successful; infrastructure failures are still real failures.

## When to read deeper skills

Read the focused skills only when the task needs them:

- `skillgym skills get cases`
  Use when creating or reshaping suite files, tags, expected failures, or per-case timeouts.
- `skillgym skills get assertions`
  Use when writing pass/fail logic against skills, commands, tool calls, output, or failure classes.
- `skillgym skills get workspaces`
  Use when the agent needs isolated filesystem state, template repos, or bootstrap commands.
- `skillgym skills get snapshots`
  Use when benchmarking token regressions or updating snapshot baselines.
- `skillgym skills get reporters`
  Use when choosing built-in reporters or wiring a custom reporter.

## Suggested authoring order

1. Start with one small case and one runner.
2. Make the assertion explicit and narrow.
3. Add tags or expected-failure behavior only after the baseline case works.
4. Add workspace isolation when shared state can affect the benchmark.
5. Add snapshots when behavior is stable enough to guard token regressions.

## Common mistakes

- asserting on vague output instead of checking the session report
- trying to select runners inside `Case` instead of config plus CLI filters
- using shared workspaces for stateful tasks that need isolation
- treating snapshot mismatches like functional failures instead of cost regressions
- writing one huge suite before proving one small representative case
