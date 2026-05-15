# Workspaces

## Overview

`skillgym` supports three workspace modes:

- `none`: run directly in an existing working directory
- `shared`: create one workspace per suite run and reuse it across executions
- `isolated`: create a fresh workspace per case x runner execution

Use `none` when the agent should run in an existing directory. Use `shared` or `isolated` when the suite needs SkillGym to provision a workspace first.

## Suite-level workspace config

Suites can export a named `workspace` object next to the default suite export.

```ts
import type { SuiteWorkspaceConfig, Case } from "skillgym";

export const workspace: SuiteWorkspaceConfig = {
  mode: "isolated",
  templateDir: "./fixtures/base-app",
  bootstrap: {
    command: "sh",
    args: ["./scripts/bootstrap-workspace.sh", "--seed", "demo"],
    timeoutMs: 120_000,
    env: {
      NODE_ENV: "test",
    },
  },
};

const suite: Case[] = [
  {
    id: "example",
    prompt: "Describe the prepared workspace.",
    assert() {},
  },
];

export default suite;
```

Suite workspace config overrides config-level `run.workspace`.

See `../examples/workspace-isolation-suite.ts` for a complete example that copies a template directory and runs a bootstrap command before the agent starts.

## None mode

```ts
export const workspace = {
  mode: "none",
  cwd: "./fixtures/repo-a",
};
```

Behavior:

- executions run directly in `cwd`
- `cwd` is optional
- if omitted, none mode falls back to config `run.cwd`, then `process.cwd()`
- `templateDir` and `bootstrap` are not allowed

If a suite file does not export `workspace`, SkillGym falls back to config `run.workspace`, then to implicit `none` mode.

## Shared mode

```ts
export const workspace = {
  mode: "shared",
  templateDir: "./fixtures/repo-template",
};
```

Behavior:

- one shared workspace is created under `outputDir/workspaces/shared`
- all executions reuse that same workspace for the suite run
- `cwd` is not allowed
- `templateDir` copies into the shared workspace before any execution starts
- `bootstrap` runs once inside the shared workspace before any execution starts
- successful suite runs delete the shared workspace
- failed suite runs preserve the shared workspace

## Isolated mode

```ts
export const workspace = {
  mode: "isolated",
  templateDir: "./fixtures/repo-template",
};
```

Behavior:

- each case x runner execution gets its own workspace
- workspace path lives under `outputDir/workspaces/<case-id>/<runner-path-key>`
- the workspace starts empty unless `templateDir` is set
- `templateDir` copies the full directory contents, including dotfiles and `.git`
- `run.cwd` is ignored in isolated mode

## Bootstrap commands

Bootstrap commands run inside the execution workspace before the agent starts.

```ts
export const workspace = {
  mode: "shared",
  bootstrap: {
    command: "sh",
    args: ["./scripts/bootstrap-workspace.sh", "--seed", "demo"],
  },
};
```

Bootstrap command behavior:

- `cwd` is the provisioned shared workspace or isolated workspace
- non-zero exit fails that execution before the agent runs
- shared-workspace bootstrap stdout and stderr are written to `outputDir/workspaces/shared-setup`
- isolated-workspace bootstrap stdout and stderr are written to the execution artifact directory

Runtime environment variables:

- `SKILLGYM_WORKSPACE`
- `SKILLGYM_OUTPUT_DIR`
- `SKILLGYM_ARTIFACT_DIR`

Isolated workspace bootstrap also receives:

- `SKILLGYM_CASE_ID`
- `SKILLGYM_RUNNER_ID`

## Cleanup

Cleanup behavior is fixed:

- successful shared suite runs delete their workspace
- failed shared suite runs preserve their workspace
- successful isolated executions delete their workspace
- failed isolated executions preserve their workspace

Preserved workspaces live under `outputDir/workspaces`.

## Path resolution

Path rules:

- config `run.workspace` paths resolve from the config file directory
- suite `workspace` paths resolve from the suite file directory
- `bootstrap.command` and path-like `bootstrap.args` are resolved from the config or suite directory before the bootstrap runs inside the execution workspace

## Limitations

- bootstrap commands are not sandboxed outside the workspace
- copying large templates may increase runtime and disk usage
- `isolated-by-runner` and `run.maxParallel` control scheduling only, not workspace reuse
