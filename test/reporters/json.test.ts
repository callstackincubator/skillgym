import { expect, test } from "vitest";
import type { SuiteRunResult } from "../../src/index.js";
import { createJsonReporter } from "../../src/reporters/json.js";

test("json reporter prints only the final suite result", async () => {
  const writes: string[] = [];
  const reporter = createJsonReporter({
    stdout: {
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    },
  });

  const result: SuiteRunResult = {
    suitePath: "examples/basic-suite.ts",
    startedAt: "2026-04-02T12:00:00.000Z",
    endedAt: "2026-04-02T12:01:00.000Z",
    durationMs: 60_000,
    outputDir: ".skillgym-results/run-1",
    declaredTags: [],
    selectedTags: [],
    cases: [],
    runners: [],
  };

  await reporter.onSuiteStart?.({
    context: {
      isInteractive: false,
      cwd: "/workspace",
      workspaceMode: "shared",
      suitePath: result.suitePath,
      outputDir: result.outputDir,
      selectedCaseCount: 0,
      selectedRunnerCount: 0,
      selectedExecutionCount: 0,
      scheduleMode: "serial",
      maxParallel: 1,
      declaredTags: [],
    },
    cases: [],
    runners: [],
    startedAt: result.startedAt,
  });
  await reporter.onSuiteFinish?.({
    context: {
      isInteractive: false,
      cwd: "/workspace",
      workspaceMode: "shared",
      suitePath: result.suitePath,
      outputDir: result.outputDir,
      selectedCaseCount: 0,
      selectedRunnerCount: 0,
      selectedExecutionCount: 0,
      scheduleMode: "serial",
      maxParallel: 1,
      declaredTags: [],
    },
    result,
  });

  expect(writes).toEqual([`${JSON.stringify(result, null, 2)}\n`]);
});
