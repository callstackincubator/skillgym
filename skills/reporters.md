---
name: reporters
description: Skillgym reporter selection and customization. Covers built-in reporters, CLI/config selection, lifecycle hooks, and when to use machine-readable output.
---

# skillgym reporters

Use this skill when choosing how benchmark results should be rendered or consumed.

## Built-in reporters

- `standard`
- `json`
- `json-summary`
- `token-usage`
- `github-actions`
- `html`

## Main commands

```bash
skillgym run <suite.ts> --reporter standard
skillgym run <suite.ts> --reporter json
skillgym run <suite.ts> --reporter json-summary
skillgym run <suite.ts> --reporter token-usage
skillgym run <suite.ts> --reporter github-actions
skillgym run <suite.ts> --reporter html
skillgym run <suite.ts> --reporter ./path/to/custom-reporter.ts
```

## Selection rules

- omitting `--reporter` uses the built-in `standard` reporter
- CLI `--reporter` overrides config `run.reporter`
- relative custom reporter paths resolve from `process.cwd()` on CLI input

## When to use each built-in reporter

- `standard`: default interactive CLI output for humans
- `json`: full aggregated result on stdout for machine consumers
- `json-summary`: trimmed result for post-processing or LLM consumption
- `token-usage`: compact JSON billable summary for optimization loops and other agent consumers
- `github-actions`: CI annotations and job summary output
- `html`: self-contained artifact for manual result review

## Custom reporter shape

```ts
import type { BenchmarkReporter } from "skillgym";

const reporter: BenchmarkReporter = {
  onSuiteFinish(event) {
    console.log(event.result.suiteRunArtifactDir);
  },
};

export default reporter;
```

## Reporter lifecycle hooks

- `onSuiteStart`
- `onCaseStart`
- `onRunnerStart`
- `onRunnerFinish`
- `onCaseFinish`
- `onSuiteFinish`
- `onError`

Use `json-summary` when another agent or tool needs a smaller result than the full session report.

Use `token-usage` when an agent needs strict compact JSON with one row per `case x runner`, comparable `billable` totals for provider-backed passed rows, and artifact paths for deeper debugging when a row fails.
