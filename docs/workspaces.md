# Workspaces

## Overview

`skillgym` supports two workspace modes:

- `shared`: run directly in a real working directory
- `isolated`: create a fresh workspace per case x runner execution

Use isolated workspaces when suites need different filesystem setups or when runs should not mutate the original source tree.

## Suite-level workspace config

Suites can export a named `workspace` object next to the default suite export.

```ts
import type { SuiteWorkspaceConfig, TestCase } from "skillgym";

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

const suite: TestCase[] = [
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

## Shared mode

```ts
export const workspace = {
  mode: "shared",
  cwd: "./fixtures/repo-a",
};
```

Behavior:
- runs execute directly in the shared directory
- `cwd` is optional
- if omitted, shared mode falls back to config `run.cwd`, then `process.cwd()`
- `templateDir` and `bootstrap` are not allowed

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

Bootstrap commands run inside the isolated workspace before the agent starts.

```ts
export const workspace = {
  mode: "isolated",
  bootstrap: {
    command: "sh",
    args: ["./scripts/bootstrap-workspace.sh", "--seed", "demo"],
  },
};
```

Bootstrap command behavior:
- `cwd` is the isolated workspace
- non-zero exit fails that execution before the agent runs
- stdout and stderr are written to the execution artifact directory

Runtime environment variables:
- `SKILLGYM_WORKSPACE`
- `SKILLGYM_CASE_ID`
- `SKILLGYM_RUNNER_ID`
- `SKILLGYM_OUTPUT_DIR`
- `SKILLGYM_ARTIFACT_DIR`

## Cleanup

Cleanup behavior is fixed:
- successful isolated runs delete their workspace
- failed isolated runs preserve their workspace

Preserved workspaces live under `outputDir/workspaces`.

## Path resolution

Path rules:
- config `run.workspace` paths resolve from the config file directory
- suite `workspace` paths resolve from the suite file directory
- `bootstrap.command` and path-like `bootstrap.args` are resolved from the config or suite directory before the bootstrap runs inside the isolated workspace

## Limitations

- bootstrap commands are not sandboxed outside the workspace
- copying large templates may increase runtime and disk usage
- `isolated-by-runner` and `run.maxParallel` control scheduling only, not workspace reuse
