# skillgym Docs

This directory contains end-user documentation for `skillgym`.

## What this project is

`skillgym` is a benchmarking tool for testing whether coding-agent skills are selected and used correctly during real agent execution.

The tool runs real sessions against supported CLIs, captures session artifacts, normalizes them into a shared report format, and executes user-provided JavaScript assertions against that report.

Workspace behavior is documented in `workspaces.md`, including shared runs, isolated runs, suite-level workspace exports, template directories, and bootstrap commands.

## Current V1 scope

Supported in V1:
- OpenCode CLI
- Codex CLI
- Claude Code CLI
- Cursor Agent CLI

## Core principles

- Real execution only
- JavaScript assertions only
- One benchmark metric: success or failure
- Session telemetry is preserved for debugging
- Best-effort execution limits should still preserve raw artifacts on failure
- TypeScript implementation
- Node.js-compatible APIs only

## Assertions

Assertion authoring and the built-in grouped `assert` API are documented in `assertions.md`, including:

- standard strict-assert usage like `assert.equal` and `assert.match`
- `assert.skills.*`
- `assert.commands.*`
- `assert.fileReads.*`
- `assert.toolCalls.*`
- `assert.output.*`

## Document map

- `test-cases.md`: test suite and test case authoring
- `assertions.md`: assertion reference and matcher semantics
- `workspaces.md`: shared and isolated workspace behavior
- `reporters.md`: reporter lifecycle, loading, and standard reporter behavior
- `session-report.md`: normalized report schema
- `snapshot.md`: token regression snapshots and baseline updates
- `skill-detection.md`: how skill selection is observed
