# Session Report

## Purpose

`SessionReport` is the normalized representation of one completed case x runner execution.

It is the only object exposed to assertions.

## Shape

```ts
export interface SessionReport {
  runner: RunnerInfo;
  sessionId?: string;
  prompt: string;

  usage: {
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cacheTokens?: number;
    inputChars: number;
    outputChars: number;
    reasoningChars: number;
    source: {
      input: "provider" | "derived" | "chars";
      output: "provider" | "derived" | "chars";
      reasoning: "provider" | "derived" | "chars";
    };
  };

  files: {
    observedReads: string[];
    observedSkillReads: string[];
  };

  detectedSkills: SkillDetection[];

  events: SessionEvent[];

  finalOutput: string;

  startedAt?: string;
  endedAt?: string;
  durationMs?: number;

  rawArtifacts: {
    stdoutPath?: string;
    stderrPath?: string;
    sessionPath?: string;
    exportPath?: string;
  };
}
```

`runner.id` is the configured runner id, and `runner.agent.type` identifies the backing integration such as `opencode`, `codex`, or `claude-code`.

## Skill detection

Skill detection should be represented as evidence, not just a boolean.

```ts
export interface SkillDetection {
  skill: string;
  confidence: "explicit" | "strong" | "medium" | "weak";
  evidence: string[];
}
```

## Event model

```ts
export type SessionEvent =
  | {
      type: "message";
      role: "user" | "assistant";
      phase?: "thinking" | "commentary" | "final";
      text: string;
      at?: string;
    }
  | { type: "toolCall"; tool: string; args?: unknown; at?: string }
  | { type: "toolResult"; tool?: string; output: string; at?: string }
  | { type: "command"; command: string; at?: string }
  | { type: "fileRead"; path: string; at?: string }
  | { type: "skillSignal"; skill: string; signal: string; at?: string };
```

`files.observedReads`, `files.observedSkillReads`, and `events[fileRead].path` use canonical absolute filesystem paths.

When a runner emits a relative path, normalization resolves it against the best available working directory for that tool call, then falls back to the message or run cwd.

## Token semantics

Preferred source order:

1. provider-reported usage
2. derived estimate from structured artifacts
3. character counts for diagnostics only

`inputTokens` is normalized to mean gross input, including cached input when the provider reports cache separately.

`outputTokens` is non-reasoning output.

`reasoningTokens` is reasoning output reported by the provider.

`cacheTokens` is cached input reused during the run.

`totalTokens` is the non-cached total used for comparisons and snapshots:

1. `inputTokens + outputTokens + reasoningTokens - cacheTokens`

This keeps OpenCode, Codex, and Claude Code comparable even though the raw provider fields use different cache semantics.

Snapshot enforcement uses the selected token metric directly and does not fall back to character counts when token usage is unavailable.

## Important limitations

- not every runner exposes skill loads explicitly
- not every runner exposes context injection directly
- file reads are observable more reliably than true hidden context inclusion
