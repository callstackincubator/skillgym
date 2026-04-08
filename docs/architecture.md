# Architecture

## Overview

The system has six main parts:

1. Suite loader
2. Runner adapter
3. Artifact collector
4. Normalizer
5. Assertion executor
6. Reporter

## End-to-end flow

1. Load a suite file written in TypeScript.
2. Resolve the target runner for each test case.
3. Launch the runner CLI with the test prompt.
4. Capture stdout, stderr, and session artifacts.
5. Normalize raw runner output into `SessionReport`.
6. Optionally compare token usage against stored snapshots.
7. Call `assert(report, ctx)`.
8. Mark the run as pass or fail.
9. Persist artifacts and normalized JSON.
10. Emit reporter lifecycle events during suite, case, and runner execution.
11. Aggregate results and write `results.json`.

Execution start order depends on the selected schedule mode:

- `serial`: one case x runner execution at a time in declaration order
- `parallel`: all planned executions may start together
- `isolated-by-runner`: each runner keeps declaration order internally while runners may overlap

## Components

### Suite loader

Loads a TypeScript module that exports test cases.

### Runner adapter

A runner-specific integration layer responsible for:
- launching the CLI
- locating the resulting session artifact
- returning raw retry data for normalization

### Artifact collector

Stores:
- stdout
- stderr
- exported session JSON or JSONL
- normalized report JSON

### Normalizer

Converts runner-specific artifacts into a shared `SessionReport`.

### Assertion executor

Executes user JavaScript assertions against the normalized report.

### Reporter

Consumes lifecycle events and presentation-ready aggregate results.

Produces:
- CLI progress and summary output
- failure details and artifact paths

The runner still owns `results.json` persistence.

## Runtime model

The project should use:
- TypeScript
- ESM
- Node.js-compatible APIs

Preferred APIs:
- `node:fs/promises`
- `node:path`
- `node:os`
- `node:child_process`
- `node:crypto`
- `node:url`

No non-Node runtime APIs should be required by the implementation.

## Execution model

Each suite resolves an effective workspace mode before runner execution starts.

Supported workspace modes:
- `shared`: all selected runs use the same working directory
- `isolated`: each case x runner execution gets its own temporary workspace

In shared mode, the working directory comes from:
- suite `workspace.cwd`, if present
- otherwise config `run.cwd`, if present
- otherwise `process.cwd()`

In isolated mode, each execution follows this lifecycle:
1. create the execution artifact directory
2. create a workspace under `outputDir/workspaces/<case>/<runner>`
3. optionally copy a configured template directory into that workspace
4. optionally run a bootstrap command inside that workspace
5. launch the runner with the isolated workspace as `cwd`
6. delete the workspace on success
7. preserve the workspace on failure for debugging

`isolated-by-runner` still refers only to scheduling. It does not change workspace provisioning by itself.

## Proposed source layout

```text
src/
  cli/
  adapters/
  normalize/
  runner/
  assertions/
  domain/
  utils/
  reporters/
```
