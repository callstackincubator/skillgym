# Product Definition

## Problem

Skill authors need a way to verify whether their `SKILL.md` structure causes a skill to be selected when appropriate, and whether the resulting execution follows the intended workflow.

Today this is mostly manual and anecdotal.

## Goal

Build a benchmark tool that can:

1. Run real agent sessions against supported CLIs.
2. Capture enough session telemetry to inspect:
   - tool calls
   - commands
   - file reads
   - final output
   - token usage
   - reasoning usage when available
3. Execute user-provided JavaScript assertions against the normalized run result.
4. Repeat retries and report an empirical success rate.

## Success definition

A retry is successful if the test case's `assert(report, ctx)` function completes without throwing.

A test case's benchmark result is:

- `successRate = passedRetries / totalRetries`

There is no separate top-level `skillPickRate` metric in V1. If a test wants to verify skill selection, it should assert that inside `assert`.

## What this tool is not

V1 is not:
- a linter for `SKILL.md`
- a recommender that rewrites metadata
- a universal abstraction across all coding agents
- a semantic grader of answer quality
- a deterministic proof of why a skill was selected

## Main use cases

- Verify a skill is selected often enough for a prompt category
- Verify a skill-driven workflow is followed
- Compare prompt or metadata changes over repeated runs
- Measure token and file-read cost of a workflow
- Debug flaky skill invocation behavior

## Non-goals for V1

- automatic fix suggestions
- declarative assertion DSL
- Claude adapter
- hidden-context introspection beyond what telemetry exposes
- isolated per-retry workspace copies

## Execution model in V1

V1 runs retries directly against the target workspace.

This keeps the first version simpler, but it also means:
- retries may mutate the workspace
- earlier retries may influence later retries
- some flakiness may come from repo state, not only model behavior

Workspace isolation should be revisited later.
