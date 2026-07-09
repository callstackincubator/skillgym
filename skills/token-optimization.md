---
name: token-optimization
description: Reduce billable token usage for one explicit Skillgym target. Covers baseline measurement with the token-usage reporter, minimal safe edits, verification loops, and when to fall back to artifacts.
---

# skillgym token-optimization

Use this skill when the goal is to reduce billable token usage for one explicit target without breaking the benchmark.

## Required input

Start only when the optimization target is explicit.

- valid targets: one prompt, one benchmark case, one suite slice, or one bundled skill/workflow file
- if the target is missing, ask one short clarification question and wait

## Optimization loop

1. Identify the smallest protecting suite or case slice that proves the target still works.
2. If none exists, create the smallest safe suite coverage first.
3. Run a passing baseline with the compact reporter.
4. Read the baseline JSON and note only comparable passed rows.
5. Make the smallest safe metadata edit to the explicit target.
6. Re-run the same slice.
7. Compare before and after billable totals only on passed comparable rows.
8. Stop when you hit the budget, reduction goal, or iteration limit.

## Main commands

```bash
skillgym run <suite.ts> --reporter token-usage
skillgym run <suite.ts> --case <id> --reporter token-usage
skillgym run <suite.ts> --runner <runner-id> --reporter token-usage
```

## Rules

- require a passing baseline before editing
- keep stdout parsing on the `token-usage` reporter only
- do not create a second detailed token report; use the normal artifact directory for debugging
- failed rows still matter for diagnosis, but do not count lower token usage on failed rows
- derived or unavailable token rows are not comparable; treat `billable: null` as non-comparable
- prefer one safe minimization pass plus one verification run by default
- re-run after every change instead of batching edits
- keep edits scoped to the named target; avoid unrelated cleanup

## How to compare runs

- compare `rows[*].billable` for passed rows only
- use top-level `billable` only when the compared run covers the same comparable rows
- if a row fails, inspect the listed `artifacts` path and the standard run output before deciding what changed
- if the baseline does not pass, fix benchmark stability first instead of claiming a token win

## Good targets

- tighten one prompt that causes repeated tool churn
- shorten one bundled skill section that the agent reads every run
- remove redundant instructions from one stable workflow

## Do not use this skill for

- broad benchmark rewrites
- multi-target refactors with unclear attribution
- unstable suites that are still failing for functional reasons

## After stabilization

If the behavior is stable and you want regression protection, add or refresh snapshots after the optimization work. Snapshots are optional follow-up protection, not part of the optimization loop itself.
