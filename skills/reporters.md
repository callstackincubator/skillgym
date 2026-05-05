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
- `github-actions`

## Main commands

```bash
skillgym run <suite.ts> --reporter standard
skillgym run <suite.ts> --reporter json
skillgym run <suite.ts> --reporter json-summary
skillgym run <suite.ts> --reporter github-actions
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
- `github-actions`: CI annotations and job summary output

## Custom reporter shape

```ts
import type { BenchmarkReporter } from "skillgym";

const reporter: BenchmarkReporter = {
  onSuiteFinish(event) {
    console.log(event.result.outputDir);
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
