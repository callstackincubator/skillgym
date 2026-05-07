# Issue 27 Stages

This file breaks the `skillgym explain` work into implementation stages that can be landed as separate commits.

## Stage 1: Explain Metadata Foundations

Goal: Persist explainable assertion failures into run artifacts without changing CLI behavior yet.

- Extend assertion option types with optional `explain.question` support.
- Introduce internal explain question and collected-failure types.
- Capture explain question metadata at assertion failure time, including source location.
- Preserve structured soft assertion failures while keeping existing aggregate assertion error output stable.
- Write `explain.json` for failed runs when at least one explainable question exists.
- Add focused tests for hard failures, soft failures, unsupported assertions, and source metadata.

## Stage 2: Runner Resume Support

Goal: Make every runner capable of answering persisted explain questions from a prior session.

- Extend the adapter contract with an explicit resume/explain capability.
- Add structured explanation result types shared across adapters.
- Implement resume support for OpenCode.
- Implement resume support for Codex, including persisting the resume session identifier during normal runs.
- Implement resume support for Claude Code and remove or gate non-persistent session mode.
- Implement resume support for Cursor Agent.
- Add adapter-level tests for resume validation, command construction, and answer extraction.

## Stage 3: `skillgym explain` CLI

Goal: Expose deferred explanation as a user-facing command.

- Add `skillgym explain <artifactDir>` to the CLI parser and help text.
- Require users to point directly to a repetition/attempt artifact directory.
- Load and validate `report.json` and `explain.json`.
- Refuse to run if `explanations.json` already exists.
- Resume the original runner session and ask all persisted questions in order.
- Persist `explanations.json` with question, answer, source, timestamps, and runner metadata.
- Add CLI tests for success and failure modes.

## Stage 4: Docs and Polish

Goal: Document the workflow and close remaining gaps around the shipped behavior.

- Document custom explain questions in assertion docs.
- Document `skillgym explain <artifactDir>` and artifact expectations.
- Document the `explain.json` and `explanations.json` file shapes.
- Call out isolated workspace caveats and other runner-specific limitations.
- Run the broader targeted test suite and fix any regressions.
