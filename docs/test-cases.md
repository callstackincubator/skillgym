# Test Cases

This document describes how to define benchmark suites and individual test cases.

## Suite exports

A suite module must export a default suite value. The suite can be either:

- an array of `TestCase` values
- an object map of named `TestCase` values

```ts
import { assert, type TestCase } from "skillgym";

const suite: TestCase[] = [
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

```ts
import { assert, type TestSuite } from "skillgym";

const suite: TestSuite = {
  "always-passes": {
    id: "always-passes",
    prompt: "Say only: skillgym ready",
    assert(report, ctx) {
      assert.match(ctx.finalOutput(), /skillgym ready/);
    },
  },
};

export default suite;
```

## TestCase shape

`skillgym` exports this public shape:

```ts
export interface TestCase {
  id: string;
  prompt: string;
  tags?: string[];
  timeoutMs?: number;
  expectedFail?: boolean;
  classifyFailure?(result: RunnerResult): FailureClass | string | undefined;
  assert(report: SessionReport, ctx: AssertionContext): void | Promise<void>;
}
```

Field meanings:

- `id`: stable identifier used in results and artifact paths
- `prompt`: the exact prompt sent to the runner
- `tags`: optional labels for selecting cases with `--tag`; multiple selected tags use OR matching
- `timeoutMs`: optional per-case timeout override
- `expectedFail`: mark assertion failures as expected benchmark signal, not suite-health failures
- `classifyFailure(result)`: optional post-processing hook for assigning or overriding structured failure classes
- `assert(report, ctx)`: pass or fail logic for that execution

`TestCase` does not include runner selection. Each case runs against the selected configured runners.

## Tags

Tags let you run subsets of a suite without changing case order:

```ts
const suite: TestCase[] = [
  {
    id: "login-smoke",
    tags: ["smoke", "auth"],
    prompt: "Verify the login screen behavior.",
    assert() {},
  },
];
```

Run tagged cases with `--tag`. Repeated flags and comma-separated values are OR-matched, so a case runs when it has any selected tag:

```sh
skillgym run ./suite.ts --tag smoke
skillgym run ./suite.ts --tag smoke --tag auth
skillgym run ./suite.ts --tag smoke,auth
```

You can also set defaults in config with `run.tags: ["smoke"]`. CLI `--tag` values override config tags.

## Assertions in a test case

The `assert` function decides pass or fail:

- if `assert(report, ctx)` completes normally, that execution passes
- if it throws, that execution fails
- if `expectedFail: true` is set, an assertion failure is reported as `status: "expected-failed"` and `passed: true`
- if `expectedFail: true` is set and assertions pass, the run is reported as `status: "unexpected-passed"` and `passed: false`

You can use both:

- Node strict assert helpers such as `assert.ok`, `assert.equal`, and `assert.match`
- `skillgym` grouped helpers such as `assert.skills.has` and `assert.commands.includes`

```ts
import { assert, type TestCase } from "skillgym";

const suite: TestCase[] = [
  {
    id: "find-skills-expo",
    prompt: "Find a skill for upgrading Expo SDK and tell me how to install it.",
    assert(report) {
      assert.skills.has(report, "find-skills");
      assert.commands.includes(report, "npx skills find");
      assert.match(report.finalOutput, /upgrading-expo/i);
    },
  },
];
```

See `assertions.md` for the full assertion reference.

## Failure classification hooks

Use failure classification when you want to group multiple failing runs under one shared cause, such as a pseudo command, wrong CLI alias, missing required flag, or wrong command family.

There are two integration points:

- `assert.classify(...)` attaches a failure class directly where an assertion is made
- `classifyFailure(result)` lets the test case assign or override the final class after the run result is available

Example:

```ts
import { assert, type TestCase } from "skillgym";

const suite: TestCase[] = [
  {
    id: "cursor-alias-check",
    prompt: 'Say you would run: cursr agent "open README.md".',
    classifyFailure(result) {
      return result.error?.message.includes("wrong Cursor CLI alias")
        ? { id: "wrong-cli-alias", label: "Wrong CLI alias" }
        : undefined;
    },
    assert(_report, ctx) {
      assert.classify({ id: "wrong-cli-alias", label: "Wrong CLI alias" }, () => {
        assert.doesNotMatch(
          ctx.finalOutput(),
          /\bcursr\s+agent\b/i,
          "wrong Cursor CLI alias in final output",
        );
      });
    },
  },
];
```

Notes:

- `assert.classify(...)` is the smallest way to tag a single assertion failure
- `classifyFailure(result)` is useful when several different assertion messages should collapse into one shared class
- if both are used, `classifyFailure(result)` runs later and can override the attached class
- built-in infrastructure failures still receive default classes such as `Assertion failure`, `Timeout`, `Runner crash`, or `Max steps exceeded`

## Expected failures

Use `expectedFail: true` for benchmark cases that intentionally capture a known model or agent gap. Expected failures only apply to assertion failures. Runner crashes, timeouts, workspace setup failures, collection failures, normalization failures, snapshot failures, and `run.maxSteps` failures still fail suite health because they indicate infrastructure or benchmark integrity problems.

```ts
import { assert, type TestCase } from "skillgym";

const suite: TestCase[] = [
  {
    id: "known-missing-skill-selection",
    prompt: "Use the correct installed skill before editing files.",
    expectedFail: true,
    assert(report) {
      assert.skills.has(report, "required-skill");
    },
  },
];
```

Expected assertion failures exit successfully and appear in `results.json` with `passed: true` and `status: "expected-failed"`. Unexpected passes exit non-zero with `passed: false` and `status: "unexpected-passed"`, which signals that the benchmark expectation may be stale or the agent improved.

## AssertionContext helpers

The second argument to `assert` is a convenience wrapper around the normalized report:

```ts
export interface AssertionContext {
  getCommands(): string[];
  getToolCalls(tool?: string): SessionEvent[];
  getFileReads(): string[];
  detectedSkills(): SkillDetection[];
  finalOutput(): string;
}
```

Examples:

```ts
assert(report, ctx) {
  assert.ok(ctx.getCommands().length > 0);
  assert.match(ctx.finalOutput(), /ready/);
}
```

These helpers are convenience APIs only. The source of truth is always the `SessionReport` passed as the first argument.

## Workspace export

A suite can also export a named `workspace` object to control where executions run.

```ts
import type { SuiteWorkspaceConfig, TestCase } from "skillgym";

export const workspace: SuiteWorkspaceConfig = {
  mode: "isolated",
  templateDir: "./fixtures/base-app",
  bootstrap: {
    command: "sh",
    args: ["./scripts/bootstrap-workspace.sh", "--seed", "demo"],
  },
};

const suite: TestCase[] = [
  {
    id: "workspace-check",
    prompt: "Describe the prepared workspace.",
    assert() {},
  },
];

export default suite;
```

`SuiteWorkspaceConfig` supports two modes:

```ts
export type SuiteWorkspaceConfig =
  | {
      mode: "shared";
      cwd?: string;
    }
  | {
      mode: "isolated";
      templateDir?: string;
      bootstrap?: {
        command: string;
        args?: string[];
        timeoutMs?: number;
        env?: Record<string, string>;
      };
    };
```

Rules:

- `shared` mode supports `cwd` only
- `isolated` mode supports `templateDir` and `bootstrap` only
- relative suite workspace paths resolve from the suite file directory
- isolated workspaces start empty when `templateDir` is omitted
- `templateDir` copies the full directory contents, including dotfiles and `.git`
- failed isolated runs preserve their workspace under `outputDir/workspaces`

See `workspaces.md` for behavior, path resolution, cleanup, and bootstrap details.

## Pass/fail behavior

- a case execution passes when its `assert` function completes without throwing
- a case execution fails when `assert` throws
- `passed` is expectation-aware suite health; use `status` to distinguish `passed`, `failed`, `expected-failed`, and `unexpected-passed`
- a case execution also fails when the runner crashes, times out, or exceeds `run.maxSteps`
- `run.maxSteps` is a best-effort streamed model-round limit, not a hard portable turn cap
- `max-steps` failures preserve raw stdout/stderr artifacts for debugging
- `max-steps` failures do not produce a partial normalized session report
- failure messages are preserved in the run artifacts

## Examples

- `../examples/basic-suite.ts`
- `../examples/skill-selection-suite.ts`
- `../examples/workspace-isolation-suite.ts`
