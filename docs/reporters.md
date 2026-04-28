# Reporters

`skillgym` reporting is pluggable.

Execution, aggregation, and `results.json` writing stay in the runner. Reporters receive lifecycle events and handle presentation.

## CLI

```bash
skillgym run <suite.ts> --reporter standard
skillgym run <suite.ts> --reporter ./examples/custom-reporter.ts
skillgym run <suite.ts> --schedule isolated-by-runner --max-parallel 4
```

- Omitting `--reporter` uses the built-in `standard` reporter.
- `standard` explicitly selects the built-in reporter.
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
- Full stack traces are not shown by default.

Reporter-visible token metrics on `RunnerSummary` include:

- `averageInputTokens`
- `averageOutputTokens`
- `averageReasoningTokens`
- `averageCacheTokens`
- `averageTotalTokens`

`averageTotalTokens` is shown as `billable` and uses normalized non-cached totals so different runner providers stay comparable.
