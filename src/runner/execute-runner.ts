import path from "node:path";
import type { RunnerAdapter } from "../domain/adapter.js";
import type { RunnerResult } from "../domain/result.js";
import type { RunnerInfo } from "../domain/runner.js";
import type { SessionReport } from "../domain/session-report.js";
import type { TestCase } from "../domain/test-case.js";
import { createAssertionContext } from "../assertions/context.js";
import type { SnapshotRuntimeOptions, SnapshotStore } from "../snapshots/store.js";
import { ensureDir, writeJson } from "../utils/fs.js";
import { isCommandTimeoutError } from "../utils/process.js";
import { createExecutionFailureResult } from "./workspace.js";

export async function executeRunner(
  testCase: TestCase,
  runner: RunnerInfo,
  adapter: RunnerAdapter,
  options: {
    cwd: string;
    artifactDir: string;
    timeoutMs: number;
    showRunnerOutput?: boolean;
    snapshots?: {
      runtime: SnapshotRuntimeOptions;
      store: SnapshotStore;
    };
  },
): Promise<RunnerResult> {
  const artifactDir = options.artifactDir;
  await ensureDir(artifactDir);

  const input = {
    runner,
    prompt: testCase.prompt,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    artifactsDir: artifactDir,
    showRunnerOutput: options.showRunnerOutput,
  };

  const startedMs = Date.now();
  let report: SessionReport | undefined;

  try {
    const handle = await adapter.run(input);
    const artifacts = await adapter.collect(handle, input);
    report = await adapter.normalize(input, artifacts);

    if (options.snapshots !== undefined) {
      applySnapshotCheck(testCase.id, runner, report, options.snapshots.store, options.snapshots.runtime);
    }

    const ctx = createAssertionContext(report);

    try {
      await testCase.assert(report, ctx);
    } catch (error) {
      const result = createExecutionFailureResult(error, {
        testCase,
        runner,
        artifactDir,
        durationMs: Date.now() - startedMs,
        failureType: "assertion",
        report,
      });

      await writeJson(path.join(artifactDir, "error.json"), result.error);
      await writeJson(path.join(artifactDir, "report.json"), result.report);

      return result;
    }

    await writeJson(path.join(artifactDir, "report.json"), report);

    return {
      runner,
      passed: true,
      durationMs: Date.now() - startedMs,
      artifactDir,
      report,
    };
  } catch (error) {
    const result = createExecutionFailureResult(error, {
      testCase,
      runner,
      artifactDir,
      durationMs: Date.now() - startedMs,
      failureType: isCommandTimeoutError(error) ? "timeout" : undefined,
      report,
    });

    await writeJson(path.join(artifactDir, "error.json"), result.error);
    await writeJson(path.join(artifactDir, "report.json"), result.report);

    return result;
  }
}

function applySnapshotCheck(
  caseId: string,
  runner: RunnerInfo,
  report: SessionReport,
  store: SnapshotStore,
  runtime: SnapshotRuntimeOptions,
): void {
  const metric = runtime.config.metric ?? "totalTokens";
  const actual = report.usage[metric];

  if (typeof actual !== "number" || !Number.isFinite(actual)) {
    throw new Error(
      `Snapshot check requires provider token metric ${metric}, but it was unavailable for ${caseId} / ${runner.id}.`,
    );
  }

  store.check({
    caseId,
    runner,
    actual,
  }, runtime);
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}
