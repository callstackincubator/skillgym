---
name: snapshots
description: Token regression snapshots in Skillgym. Covers baseline creation, tolerance checks, update flows, metrics, and when snapshots should be used.
---

# skillgym snapshots

Use this skill when the benchmark should guard token usage regressions.

## Purpose

Snapshots compare the current run against a stored baseline for each `caseId + runner.id` pair.

This is useful for catching regressions caused by:

- skill changes that make the agent do more work
- tool changes that return too much data
- model behavior changes that increase token usage

## Important behavior

- default metric is `totalTokens`
- missing snapshot entries are created automatically
- the run fails when usage exceeds the configured tolerance
- snapshots are cost guards, not functional assertions

## Main commands

```bash
skillgym run <suite.ts> --update-snapshots
skillgym run <suite.ts> --snapshots ./skillgym.snapshots.json
```

## Supported metrics

- `totalTokens`
- `inputTokens`
- `outputTokens`
- `reasoningTokens`
- `cacheTokens`

## When to add snapshots

- after the benchmark behavior is already stable
- when you want to catch prompt or tooling cost regressions
- when the selected runner reports the needed token metric reliably

## When not to rely on snapshots alone

- when the case still lacks functional assertions
- when the run is flaky for reasons unrelated to token usage
- when you are still exploring prompt shape and workflow
