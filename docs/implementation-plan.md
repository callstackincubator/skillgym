# Implementation Plan

## Phase 0: spikes

### Spike 1: OpenCode session correlation

Goal:
- prove a launched run can be mapped to an exported session deterministically

Output:
- documented correlation strategy

### Spike 2: Codex session correlation

Goal:
- prove `npx codex exec` can be mapped to the correct JSONL artifact deterministically

Output:
- documented correlation strategy

### Spike 3: normalization rules

Goal:
- define how both runners map into the shared `SessionReport`

Output:
- stable field mapping spec

## Phase 1: core benchmark engine

Build:
- domain types
- suite loader
- OpenCode adapter
- Codex adapter
- normalizer
- assertion executor
- JSON artifact writer
- CLI `run` command

Acceptance:
- one suite can be executed end to end
- per-retry artifacts are written
- pass or fail result is stable

## Phase 2: reporting

Build:
- aggregate success rate
- token averages
- duration averages
- file-read averages
- readable CLI summary
- JSON summary output

Acceptance:
- repeated retries produce aggregated output
- failures remain debuggable through saved artifacts

## Phase 3: ergonomics

Build:
- helper assertion context
- artifact inspection command
- result comparison command
- CI-friendly exit codes

Acceptance:
- users can debug failing or flaky tests without reading raw session artifacts manually

## Known risks

- inferred skill detection may be imperfect
- runner artifact schemas may change
- reasoning telemetry may differ between runners
- runs may mutate the workspace
- repeated retries may be affected by prior retry state

## V1 exit criteria

V1 is complete when:
1. OpenCode runs are benchmarkable end to end
2. Codex runs are benchmarkable end to end
3. suites can express skill checks in JS assertions
4. repeated retries report a single success rate
5. token, timing, and file-read telemetry are preserved in the result artifacts
