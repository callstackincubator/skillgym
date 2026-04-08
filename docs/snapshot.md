# Snapshots

## Purpose

Snapshot checks guard token usage regressions for each executed `caseId + runner.id` pair.

This is useful for catching regressions caused by:
- skill changes that make the agent do more work
- tool changes that return too much data
- model behavior changes that increase token usage unexpectedly

Phase 1 is a per-run guard, not a statistical benchmark. A single run is compared against a stored baseline with configurable tolerance.

## Default behavior

- Metric: `totalTokens`
- Key: `caseId + runner.id`
- Missing snapshot: auto-create from the current run
- Failure: the run fails when usage exceeds the configured threshold

If both tolerances are configured, exceeding either one fails the run.

## Configuration

```ts
export default {
  runners: {
    open-main: {
      agent: {
        type: "opencode",
        model: "openai/gpt-5",
      },
    },
    code-main: {
      agent: {
        type: "codex",
        model: "gpt-5",
      },
    },
  },
  snapshots: {
    path: "./skillgym.snapshots.json",
    metric: "totalTokens",
    tolerance: {
      absolute: 300,
      percent: 15,
    },
  },
};
```

Supported metrics:
- `totalTokens`
- `inputTokens`
- `outputTokens`
- `reasoningTokens`
- `completionTokens`

Snapshot checks require the selected token metric to be present in the normalized report. Character counts are diagnostics only and are not used as a token fallback for snapshot enforcement.

## CLI

```bash
skillgym run ./examples/basic-suite.ts --update-snapshots
```

```bash
skillgym run ./examples/basic-suite.ts --snapshots ./baselines.json
```

Flags:
- `--update-snapshots`: overwrite baselines for the executed runs
- `--snapshots <path>`: override the configured snapshot file path

## File format

```json
{
  "version": 1,
  "entries": {
    "basic-help::open-main": {
      "caseId": "basic-help",
      "runnerId": "open-main",
      "metric": "totalTokens",
      "value": 16604,
      "agentType": "opencode",
      "model": "openai/gpt-5",
      "updatedAt": "2026-04-04T12:00:00.000Z"
    }
  }
}
```

## Failure example

```text
Snapshot mismatch for totalTokens:
actual 19240 > allowed 18100
baseline 16604, +2636 tokens (+15.9%)
key: find-skills-expo-strict / open-main
Run with --update-snapshots to accept the new baseline.
```

## Notes

- Missing snapshots are created automatically during normal runs.
- `--update-snapshots` only refreshes the executed `caseId + runner.id` pairs.
- Snapshot files should be reviewed like other test fixtures.
- Phase 1 does not model variance statistically. Aggregate and percentile-based checks can be added later.
