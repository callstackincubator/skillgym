# Reporters

`skillgym` reporting is pluggable.

Execution, aggregation, and `results.json` writing stay in the runner. Reporters receive lifecycle events and handle presentation.

## CLI

```bash
skillgym run <suite.ts> --reporter standard
skillgym run <suite.ts> --reporter json
skillgym run <suite.ts> --reporter json-summary
skillgym run <suite.ts> --reporter github-actions
skillgym run <suite.ts> --reporter ./examples/custom-reporter.ts
skillgym run <suite.ts> --schedule isolated-by-runner --max-parallel 4
```

- Omitting `--reporter` uses the built-in `standard` reporter.
- Built-in reporters are `standard`, `json`, `json-summary`, and `github-actions`.
- Relative paths resolve from `process.cwd()`.

## Config

Reporter selection can also come from `skillgym.config.*`:

```ts
export default {
  run: {
    reporter: "./examples/custom-reporter.ts",
  },
};
```

- Relative config reporter paths resolve from the config file directory.
- CLI `--reporter` overrides config.
- Omitting both still uses the built-in `standard` reporter.

## Module contract

```ts
import type { BenchmarkReporter } from "skillgym";

const reporter: BenchmarkReporter = {
  onSuiteStart(event) {
    console.log(`Running ${event.context.suitePath}`);
  },
};

export default reporter;
```

```ts
import type { BenchmarkReporter } from "skillgym";

export const reporter: BenchmarkReporter = {
  onSuiteFinish(event) {
    console.log(event.result.outputDir);
  },
};
```

Validation rules:

- The module must export an object.
- The object must implement at least one recognized reporter hook.
- Unknown properties are ignored.
- Invalid reporter modules fail the run with a clear error.

## Lifecycle

Hooks:

- `onSuiteStart`
- `onCaseStart`
- `onRunnerStart`
- `onRunnerFinish`
- `onCaseFinish`
- `onSuiteFinish`
- `onError`

Semantics:

1. `onSuiteStart`
2. `onCaseStart` when the first execution for a case starts
3. `onRunnerStart` and `onRunnerFinish` in real execution order
4. `onCaseFinish` when the last execution for a case finishes
5. `onSuiteFinish`

Final result ordering stays stable even in concurrent schedules:

- `SuiteRunResult.cases` stays in selected case order
- `CaseResult.runnerResults` stays in selected runner order

`ReporterContext.scheduleMode` exposes the selected schedule and `ReporterContext.maxParallel` exposes the effective execution concurrency so custom reporters can adapt their output.

Top-level execution failures call `onError` before the error is rethrown.

## Standard reporter

The built-in `standard` reporter is optimized for polished CLI output.

- Interactive TTY mode can show multiple live running entries at once.
- Non-interactive mode avoids redraws and prints stable lines only.
- Non-serial schedules with concurrency above 1 print a warning because runs may overlap in the same workspace.
- Every run prints suite metadata, compact per-run token columns (`in`, `out`, `reason`, `cache`, `billable`) when available, a final summary, and failure artifact paths.
- Run statuses are reported as `passed`, `failed`, `expected-failed`, or `unexpected-passed`.
- Expected failures count as passed suite health, are labeled `expected failure`, and are excluded from the failure details section.
- Unexpected passes count as failures and are labeled `unexpected pass` because the benchmark expectation may be stale.
- Summary output includes expected-failure and unexpected-pass counts in addition to pass/fail totals.
- Full stack traces are not shown by default.

Reporter-visible token metrics on `RunnerSummary` include:

- `averageInputTokens`
- `averageOutputTokens`
- `averageReasoningTokens`
- `averageCacheTokens`
- `averageTotalTokens`

`averageTotalTokens` is shown as `billable` and uses normalized non-cached totals so different runner providers stay comparable.

## JSON reporter

The built-in `json` reporter only writes the final aggregated `SuiteRunResult` JSON to stdout.

- It ignores live progress hooks.
- It does not change the `results.json` artifact written by the runner.
- It is useful for CI steps that want machine-readable stdout.

## JSON summary reporter

The built-in `json-summary` reporter writes a trimmed JSON summary to stdout — smaller than the full `json` reporter output and optimized for LLM consumption.

- It ignores live progress hooks.
- The output includes per-case and per-runner results with token usage, pass/fail status, artifact paths, and error details, but omits the full session events and raw artifacts.
- It is useful for post-run analysis steps or feeding results to an LLM.

## GitHub Actions reporter

The built-in `github-actions` reporter is designed for GitHub CI.

- Failed runs emit `::error` workflow command annotations, including file and line when a stack frame is available.
- When `GITHUB_STEP_SUMMARY` is set, the reporter appends a Markdown job summary containing:
  - Suite metadata (path, case/run counts, duration, output dir)
  - A per-runner section with a table of all cases (pass/fail status, duration, and token columns: input, output, reasoning, cache, billable)
  - A failures section listing up to 10 failures with error name/message, artifact dir, and log path
- When `GITHUB_STEP_SUMMARY` is missing, summary writing is skipped.
- PR comments stay out of scope for the reporter itself; add those in a separate CI step if needed.
