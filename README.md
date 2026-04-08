# skillgym

Benchmark coding-agent skills by running real agent sessions and asserting on normalized execution reports.

## Why it's useful

When you evaluate agent skills manually, it is hard to tell whether the agent actually selected the right skill, used it at the right time, and behaved correctly end to end. `skillgym` gives you a repeatable way to run real sessions, preserve session artifacts, verify outcomes with JavaScript assertions, and catch token regressions with snapshots.

## Supported runners

- OpenCode CLI
- Codex CLI

The package root exports the library API, including the built-in `assert` helper for suite authors. The CLI remains available through the top-level entrypoint and package bin.

## Quick start

Install dependencies:

```bash
pnpm install
```

Create `skillgym.config.*` next to your suite, or in a parent directory that the suite can discover upward:

```ts
export default {
  run: {
    cwd: ".",
    outputDir: "./.skillgym-results",
    reporter: "standard",
    schedule: "serial",
  },
  defaults: {
    timeoutMs: 120_000,
  },
  runners: {
    open-main: {
      agent: {
        type: "opencode",
        model: "openai/gpt-5",
      },
    },
    code-main: {
      agent: {
        type: "codex",
        model: "gpt-5",
      },
    },
  },
};
```

Define a suite:

```ts
import { assert, type TestCase } from "skillgym";

const suite: TestCase[] = [
  {
    id: "basic-ready",
    prompt: "Say only: skillgym ready",
    assert(report, ctx) {
      assert.match(ctx.finalOutput(), /skillgym ready/);
    },
  },
];

export default suite;
```

Run the [basic suite](examples/basic-suite.ts):

```bash
node --import tsx ./index.ts run ./examples/basic-suite.ts
```

View CLI help:

```bash
node --import tsx ./index.ts help
```

By default, `skillgym` uses the built-in `standard` reporter.

## What you need to run a suite

- a `skillgym.config.*` file with a non-empty `runners` map
- at least one configured runner with `agent.type` and `agent.model`
- the corresponding CLI installed and working in your environment
- a suite file that exports test cases

Config is discovered upward from the suite file directory. CLI flags override config values.

Runner model selection is required per runner in `runners.<name>.agent.model`.
Use `agent.model` instead of `commandArgs` when you need to select the agent model, especially for Codex where `--model` must be passed to `codex exec` rather than the outer launcher.

## Configuration

Shared defaults live in `skillgym.config.*`:

```ts
export default {
  run: {
    cwd: "./workspace-under-test",
    outputDir: "./bench-results",
    reporter: "./examples/custom-reporter.ts",
    schedule: "serial",
    workspace: {
      mode: "shared",
    },
  },
  defaults: {
    timeoutMs: 120_000,
  },
  runners: {
    open-main: {
      agent: {
        type: "opencode",
        model: "openai/gpt-5",
      },
    },
    code-main: {
      agent: {
        type: "codex",
        model: "gpt-5",
      },
    },
  },
  snapshots: {
    path: "./skillgym.snapshots.json",
    tolerance: {
      absolute: 300,
      percent: 15,
    },
  },
};
```

`run.schedule` controls execution order:

- `serial`: run every case/runner pair in declaration order
- `parallel`: start all selected case/runner pairs concurrently
- `isolated-by-runner`: keep each runner on its own serial queue while different runners may overlap

`serial` is the default. Concurrent modes do not copy or isolate the workspace; overlapping runs may still interact through the same filesystem state and live runner output. Codex and OpenCode runtime state are isolated per run under each artifact directory.

Suites can also opt into isolated workspaces with a named `workspace` export. In isolated mode, each case x runner execution gets its own temporary workspace, optionally copied from a template directory and bootstrapped with a command before the agent runs. Failed isolated workspaces are preserved under `outputDir/workspaces`.

## Assertions

`assert` extends Node's `node:assert/strict` helpers, so standard methods like `assert.ok`, `assert.equal`, and `assert.match` still work.

Built-in grouped assertions cover:

- `assert.skills.*`
- `assert.commands.*`
- `assert.fileReads.*`
- `assert.toolCalls.*`
- `assert.output.*`

Example:

```ts
import { assert } from "skillgym";

assert.skills.has(report, "find-skills");
assert.skills.notHas(report, "upgrading-expo");
assert.commands.includes(report, "npx skills find");
assert.commands.notIncludes(report, "npm install");
assert.fileReads.includes(report, /find-skills\/SKILL\.md$/);
assert.fileReads.notIncludes(report, /upgrading-expo\/SKILL\.md$/);
assert.toolCalls.has(report, {
  tool: "skill",
  where: (args) => (args as { name?: string })?.name === "find-skills",
});
assert.output.notEmpty(report);
```

See the [assertion reference](docs/assertions.md).

## Snapshots

Snapshot checks can fail runs when token usage regresses beyond a configured tolerance.

```bash
node --import tsx ./index.ts run ./examples/basic-suite.ts --update-snapshots
```

See the [snapshot guide](docs/snapshot.md).

## Reporter selection

```bash
node --import tsx ./index.ts run ./examples/basic-suite.ts --reporter standard
```

```bash
node --import tsx ./index.ts run ./examples/basic-suite.ts --schedule isolated-by-runner
```

```bash
node --import tsx ./index.ts run ./examples/basic-suite.ts --reporter ./examples/custom-reporter.ts
```

Relative custom reporter paths passed on the CLI resolve from the shell `process.cwd()`.
Relative reporter paths in config resolve from the config file directory.

## Example suites

The [skill selection suite](examples/skill-selection-suite.ts) targets a real installed skill (`find-skills`) and checks that the runner loads it before invoking `npx skills find`.

```bash
node --import tsx ./index.ts run ./examples/skill-selection-suite.ts
```

The [workspace isolation suite](examples/workspace-isolation-suite.ts) demonstrates isolated workspace setup with a template directory and bootstrap command:

```bash
node --import tsx ./index.ts run ./examples/workspace-isolation-suite.ts
```

## Custom reporter example

```ts
import type { BenchmarkReporter } from "skillgym";

const reporter: BenchmarkReporter = {
  onSuiteStart(event) {
    console.log(`Running ${event.context.suitePath}`);
  },
  onSuiteFinish(event) {
    console.log(`Results: ${event.result.outputDir}`);
  },
};

export default reporter;
```

## Docs

- [Docs Overview](docs/readme.md)
- [Test Cases](docs/test-cases.md)
- [Assertions](docs/assertions.md)
- [Workspaces](docs/workspaces.md)
- [Reporters](docs/reporters.md)
- [Snapshots](docs/snapshot.md)
