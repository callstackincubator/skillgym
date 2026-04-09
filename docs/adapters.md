# Runner Adapters

## Purpose

Each adapter integrates one CLI with the benchmark runner.

An adapter is responsible for:
- launching the CLI
- locating the correct session artifact
- collecting raw data needed for normalization

## Adapter interface

```ts
export interface RunnerAdapter {
  name: "opencode" | "codex";

  run(input: RunInput): Promise<RunHandle>;
  collect(handle: RunHandle): Promise<RawRunArtifacts>;
  normalize(artifacts: RawRunArtifacts): Promise<SessionReport>;
}
```

## OpenCode

### Evidence collected so far

`opencode export <sessionId>` exposes:
- messages
- reasoning blocks
- token usage
- cache read and write counts
- tool calls
- timing
- final output

### Expected strategy

1. launch `opencode run`
2. identify the resulting session ID
3. run `opencode export <sessionId>`
4. normalize export JSON into `SessionReport`

`skillgym` requires `runners.<name>.agent.model` for OpenCode, which maps to `opencode run --model <provider/model>`.

### Risks

- session correlation must be deterministic
- exported shapes may evolve across versions

## Codex

### Evidence collected so far

`~/.codex/sessions/**/*.jsonl` contains:
- token count events
- cached input token counts
- tool or function calls
- tool outputs
- assistant messages
- lifecycle events

### Expected strategy

1. launch `npx codex exec`
2. capture stdout and stderr
3. identify the new session artifact from the time window
4. parse JSONL and normalize into `SessionReport`

`skillgym` requires `runners.<name>.agent.model` for Codex, which maps to `codex exec --model <model>`.
This should be preferred over trying to pass `--model` through `commandArgs`, because `commandArgs` are prepended before `codex` itself.

### Risks

- session correlation is the main spike item
- CLI JSON output may not be enough on its own
- artifact schema may change between Codex versions

## Deferred adapter

Claude Code is intentionally out of scope for V1.
