---
name: workspaces
description: Skillgym shared and isolated workspaces for benchmark executions. Covers workspace modes, template directories, bootstrap commands, cleanup rules, and path resolution.
---

# skillgym workspaces

Use this skill when benchmark executions need specific filesystem state.

## Workspace modes

- `shared`: run directly in a real working directory
- `isolated`: create a fresh workspace per case x runner execution

Use isolated workspaces when executions should not mutate the original checkout or when each execution needs a prepared template.

## Shared mode

```ts
export const workspace = {
  mode: "shared",
  cwd: "./fixtures/repo-a",
  templateDir: "./fixtures/base-project",
  bootstrap: {
    command: "sh",
    args: ["./scripts/bootstrap-workspace.sh"],
  },
};
```

Behavior:

- executions run directly in that directory
- `cwd` is optional
- if omitted, Skillgym falls back to config `run.cwd`, then `process.cwd()`
- `templateDir` copies into that directory before the agent starts
- `bootstrap` runs in that directory before the agent starts

## Isolated mode

```ts
export const workspace = {
  mode: "isolated",
  templateDir: "./fixtures/repo-template",
  bootstrap: {
    command: "sh",
    args: ["./scripts/bootstrap-workspace.sh"],
  },
};
```

Behavior:

- each case x runner execution gets its own workspace
- `templateDir` copies a starter project into that workspace
- `bootstrap` runs before the agent starts
- successful isolated executions are deleted
- failed isolated executions are preserved under `outputDir/workspaces`

## When to use isolated mode

- the agent edits files
- a case depends on seed files or a fixture repo
- concurrent executions could interfere with each other
- you need reproducible filesystem setup per execution

## Runtime environment for bootstrap

- `SKILLGYM_WORKSPACE`
- `SKILLGYM_CASE_ID`
- `SKILLGYM_RUNNER_ID`
- `SKILLGYM_OUTPUT_DIR`
- `SKILLGYM_ARTIFACT_DIR`

## Good workspace practice

- default to `shared` only for read-only or intentionally real-project checks
- switch to `isolated` when filesystem mutations matter
- keep bootstrap short and deterministic
- preserve templates close to the suite when they are suite-specific
