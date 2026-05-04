![skillgym-banner](https://incubator.callstack.com/skillgym/banner.jpg)

### Benchmark coding-agent skills by running real agent sessions and asserting on normalized execution reports

[![mit licence][license-badge]][license]
[![npm downloads][npm-downloads-badge]][npm-downloads]
[![PRs Welcome][prs-welcome-badge]][prs-welcome]

## Why it's useful

When you evaluate agent skills manually, it is hard to tell whether the agent actually selected the right skill, used it at the right time, and behaved correctly end to end. `skillgym` gives you a repeatable way to run real sessions, preserve session artifacts, verify outcomes with TypeScript assertions, and catch token regressions with snapshots.

## Supported runners

- OpenCode CLI
- Codex CLI
- Claude Code
- Cursor Agent (Cursor CLI `agent`)

## Quick start

Install `skillgym` in the project where you want to benchmark agent behavior:

```bash
npm install --save-dev skillgym
yarn add --dev skillgym
pnpm add --save-dev skillgym
bun add --dev skillgym
```

Create `skillgym.config.ts` in your project root, or in a parent directory that the suite can discover upward:

```ts
import type { SkillGymConfig } from "skillgym";

const config: SkillGymConfig = {
  run: {
    cwd: ".",
    outputDir: "./.skillgym-results",
    reporter: "standard",
    schedule: "serial",
    maxParallel: 4,
    maxSteps: 4,
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
    cursor-main: {
      agent: {
        type: "cursor-agent",
        model: "composer-2-fast",
      },
    },
  },
};

export default config;
```

Create a suite file such as `./skillgym/basic-suite.ts`:

```ts
import type { TestSuite } from "skillgym";
import { assert } from "skillgym";

const suite: TestSuite = [
  {
    id: "always-passes",
    prompt: "Say only: skillgym ready",
    assert(report, ctx) {
      assert.match(ctx.finalOutput(), /skillgym ready/);
    },
  },
];

export default suite;
```

Run the suite with the package manager you use in that project:

```bash
npx skillgym run ./skillgym/basic-suite.ts
yarn skillgym run ./skillgym/basic-suite.ts
pnpm exec skillgym run ./skillgym/basic-suite.ts
bunx skillgym run ./skillgym/basic-suite.ts
```

View CLI help:

```bash
npx skillgym help
```

By default, `skillgym` uses the built-in `standard` reporter.

TypeScript config, suite, and reporter modules work out of the box on Node `>=22.18.0` using Node's built-in TypeScript stripping.

TypeScript runtime limitations:

- `.ts`, `.mts`, and `.cts` modules are supported
- `.tsx` is not supported
- runtime `tsconfig` path aliases are not supported
- use explicit file extensions in relative imports, for example `./helpers.js`
- use `import type` for type-only imports
- TypeScript features that need code generation, such as `enum`, are not supported by default

## What you need to run a suite

- a `skillgym.config.*` file with a non-empty `runners` map
- at least one configured runner with `agent.type` and `agent.model`
- the corresponding CLI installed and working in your environment
- a suite file that exports test cases

Config is discovered upward from the suite file directory. CLI flags override config values.

Runner model selection is required per runner in `runners.<name>.agent.model`.
Use `agent.model` instead of `commandArgs` when you need to select the agent model, especially for Codex where `--model` must be passed to `codex exec` rather than the outer launcher.

## Runners

A runner is one configured agent target. It tells `skillgym` which CLI to launch and which model to use for a run.

Each test case runs once per selected runner. For example, 3 cases and 2 runners produce 6 executions.

## Configuration

Most important config properties:

- `run.cwd`: working directory used for shared-workspace runs
- `run.outputDir`: where artifacts, reports, and preserved workspaces are written
- `run.reporter`: built-in `standard` reporter or a custom reporter module path
- `run.schedule`: execution scheduling mode for case x runner pairs
- `run.maxParallel`: maximum concurrent executions for non-serial schedules, defaulting to available CPU parallelism
- `run.maxSteps`: best-effort limit on streamed agent steps before skillgym terminates the run
- `run.workspace`: default workspace mode for the suite
- `defaults.timeoutMs`: default per-case timeout
- `runners.<id>.agent.type`: which agent integration to use, currently `opencode`, `codex`, `claude-code`, or `cursor-agent`
- `runners.<id>.agent.model`: model passed to that runner
- `snapshots`: token regression baseline configuration

The execution unit is one case x runner pair. `skillgym` expands the suite into those pairs, runs them according to `run.schedule`, and writes artifacts for each execution.

`run.schedule` controls execution order:

- `serial`: run every case/runner pair in declaration order
- `parallel`: run selected case/runner pairs concurrently, capped by `run.maxParallel`
- `isolated-by-runner`: keep each runner on its own serial queue while different runners may overlap, capped by `run.maxParallel`

`serial` is the default. `parallel` maximizes overlap across the full matrix up to the configured cap. `isolated-by-runner` is a middle ground when you want each runner to stay ordered internally but still allow different runners to overlap.

For concurrent schedules, `run.maxParallel` defaults to `os.availableParallelism()`. This limits how many SkillGym executions are active at once; it does not pin or limit CPU cores used by an individual agent process.

Concurrent schedules do not copy or isolate the workspace by themselves. Overlapping runs may still interact through the same filesystem state and live runner output unless you use isolated workspaces. OpenCode, Codex, and Claude Code runtime state are isolated per run under each artifact directory.

`run.maxSteps` is enforced on a best-effort basis by monitoring each runner's streamed JSONL output. A step is one observed model round, not one token and not necessarily one tool call, but the exact boundary is still runner-defined, so the same prompt may consume different numbers of steps across agents. When the observed step count exceeds the configured limit, skillgym kills the agent process, fails the run with origin `max-steps`, and preserves raw stdout/stderr artifacts for debugging. No partial normalized report is produced for that failure.

## Workspaces

A workspace is the directory where an execution runs.

`skillgym` supports two workspace modes:

- `shared`: run directly in one real directory
- `isolated`: create a fresh temporary workspace per case x runner execution

Use `shared` when you want the agent to work against your real project checkout. Use `isolated` when you want clean filesystem state per execution or need to prepare each run from a template.

You can configure workspaces in `skillgym.config.*` with `run.workspace`, or per suite with a named `workspace` export. Suite-level workspace config overrides config-level `run.workspace`.

Isolated workspace example in a suite:

```ts
export const workspace = {
  mode: "isolated",
  templateDir: "./fixtures/base-project",
  bootstrap: {
    command: "npm",
    args: ["install"],
  },
};
```

In isolated mode, each execution gets its own workspace. `templateDir` copies a starter project into that workspace, and `bootstrap` runs before the agent starts. Successful isolated runs are cleaned up; failed ones are preserved under `outputDir/workspaces` for debugging.

See [Workspaces](docs/workspaces.md) for the full workspace reference.

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
import { assert, commandMatcher } from "skillgym";

assert.skills.has(report, "find-skills");
assert.skills.notHas(report, "upgrading-expo");
assert.commands.includes(report, "npx skills find");
assert.commands.includes(report, commandMatcher("pnpm").arg("test").flag("--watch"));
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
npx skillgym run ./examples/basic-suite.ts --update-snapshots
```

See the [snapshot guide](docs/snapshot.md).

## Example suites

The [skill selection suite](examples/skill-selection-suite.ts) targets a real installed skill (`find-skills`) and checks that the runner loads it before invoking `npx skills find`.

```bash
npx skillgym run ./examples/skill-selection-suite.ts
```

The [workspace isolation suite](examples/workspace-isolation-suite.ts) demonstrates isolated workspace setup with a template directory and bootstrap command:

```bash
npx skillgym run ./examples/workspace-isolation-suite.ts
```

The [failure classification suite](examples/failure-classification-suite.ts) demonstrates `assert.classify(...)` and `classifyFailure(...)` so reporters can group related failures under one class:

```bash
npx skillgym run ./examples/failure-classification-suite.ts
```

## Docs

The documentation site is at [incubator.callstack.com/skillgym](https://incubator.callstack.com/skillgym/). Repository docs:

- [Docs Overview](docs/readme.md)
- [Test Cases](docs/test-cases.md)
- [Assertions](docs/assertions.md)
- [Workspaces](docs/workspaces.md)
- [Reporters](docs/reporters.md)
- [Snapshots](docs/snapshot.md)

## Made with ❤️ at Callstack

`skillgym` is an open source project and will always remain free to use. If you think it's cool, please star it 🌟. [Callstack][callstack-readme-with-love] is a group of React and React Native geeks, contact us at [hello@callstack.com](mailto:hello@callstack.com) if you need any help with these or just want to say hi!

Like the project? ⚛️ [Join the team](https://callstack.com/careers/?utm_campaign=Senior_RN&utm_source=github&utm_medium=readme) who does amazing stuff for clients and drives React Native Open Source! 🔥

[callstack-readme-with-love]: https://callstack.com/?utm_source=github.com&utm_medium=referral&utm_campaign=skillgym&utm_term=readme-with-love
[license-badge]: https://img.shields.io/npm/l/skillgym?style=for-the-badge
[license]: https://github.com/callstackincubator/skillgym/blob/main/LICENSE
[npm-downloads-badge]: https://img.shields.io/npm/dm/skillgym?style=for-the-badge
[npm-downloads]: https://www.npmjs.com/package/skillgym
[prs-welcome-badge]: https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge
[prs-welcome]: https://github.com/callstackincubator/skillgym
