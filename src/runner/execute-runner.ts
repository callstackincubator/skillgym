import path from "node:path";
import { AssertionError } from "node:assert";
import type { ExplainArtifact } from "../domain/explain.js";
import type { RunnerAdapter } from "../domain/adapter.js";
import type { RunnerFailureOrigin, RunnerResult } from "../domain/result.js";
import type { RunnerInfo } from "../domain/runner.js";
import type { SessionReport } from "../domain/session-report.js";
import type { Case } from "../domain/case.js";
import { getAttachedExplainQuestions } from "../assertions/explain.js";
import { createAssertionContext } from "../assertions/context.js";
import { getAttachedFailureClass } from "../failure-classification.js";
import { runWithSoftAssertions } from "../assertions/soft.js";
import type { SnapshotRuntimeOptions, SnapshotStore } from "../snapshots/store.js";
import { ensureDir, writeJson } from "../utils/fs.js";
import { isCommandTimeoutError, isMaxStepsExceededError } from "../utils/process.js";
import { createExecutionFailureResult } from "./workspace.js";

export async function executeRunner(
  case_: Case,
  runner: RunnerInfo,
  adapter: RunnerAdapter,
  options: {
    suitePath: string;
    cwd: string;
    artifactDir: string;
    timeoutMs: number;
    maxSteps?: number;
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
    prompt: case_.prompt,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    maxSteps: options.maxSteps,
    artifactsDir: artifactDir,
    showRunnerOutput: options.showRunnerOutput,
  };

  const startedMs = Date.now();

  try {
    const handle = await adapter.run(input);
    let artifacts: Awaited<ReturnType<typeof adapter.collect>>;

    try {
      artifacts = await adapter.collect(handle, input);
    } catch (error) {
      return await writeAndReturnFailure(error, {
        suitePath: options.suitePath,
        cwd: options.cwd,
        case: case_,
        runner,
        artifactDir,
        durationMs: Date.now() - startedMs,
        failureOrigin: "collection",
      });
    }

    let report: SessionReport;

    try {
      report = await adapter.normalize(input, artifacts);
    } catch (error) {
      return await writeAndReturnFailure(error, {
        suitePath: options.suitePath,
        cwd: options.cwd,
        case: case_,
        runner,
        artifactDir,
        durationMs: Date.now() - startedMs,
        failureOrigin: "normalization",
      });
    }

    if (options.snapshots !== undefined) {
      try {
        applySnapshotCheck(
          case_.id,
          runner,
          report,
          options.snapshots.store,
          options.snapshots.runtime,
        );
      } catch (error) {
        return await writeAndReturnFailure(error, {
          suitePath: options.suitePath,
          cwd: options.cwd,
          case: case_,
          runner,
          artifactDir,
          durationMs: Date.now() - startedMs,
          failureOrigin: "snapshot",
          report,
        });
      }
    }

    const ctx = createAssertionContext(report);

    try {
      await runWithSoftAssertions(() => case_.assert(report, ctx));
    } catch (error) {
      const isAssertionFailure = error instanceof AssertionError;
      return await writeAndReturnFailure(error, {
        suitePath: options.suitePath,
        cwd: options.cwd,
        case: case_,
        runner,
        artifactDir,
        durationMs: Date.now() - startedMs,
        failureOrigin: isAssertionFailure ? "assertion" : "assert-hook",
        failureClass: getAttachedFailureClass(error),
        report,
      });
    }

    await writeJson(path.join(artifactDir, "report.json"), report);

    return {
      runner,
      passed: true,
      status: "passed",
      durationMs: Date.now() - startedMs,
      executionArtifactDir: artifactDir,
      artifactDir,
      report,
    };
  } catch (error) {
    return await writeAndReturnFailure(error, {
      suitePath: options.suitePath,
      cwd: options.cwd,
      case: case_,
      runner,
      artifactDir,
      durationMs: Date.now() - startedMs,
      failureOrigin: isMaxStepsExceededError(error) ? "max-steps" : "runner",
      failureClass: isCommandTimeoutError(error) ? { id: "timeout", label: "Timeout" } : undefined,
      failureLogPath: path.join(artifactDir, "stderr.log"),
    });
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

  store.check(
    {
      caseId,
      runner,
      actual,
    },
    runtime,
  );
}

async function writeAndReturnFailure(
  error: unknown,
  options: {
    suitePath: string;
    cwd: string;
    case: Case;
    runner: RunnerInfo;
    artifactDir: string;
    durationMs: number;
    failureOrigin?: RunnerFailureOrigin;
    failureClass?: RunnerResult["failureClass"];
    failureLogPath?: string;
    report?: SessionReport;
  },
): Promise<RunnerResult> {
  const result = createExecutionFailureResult(error, options);
  await writeJson(path.join(options.artifactDir, "error.json"), result.error);
  await writeJson(path.join(options.artifactDir, "report.json"), result.report);
  await writeExplainArtifactIfNeeded(error, {
    suitePath: options.suitePath,
    cwd: options.cwd,
    caseId: options.case.id,
    runnerId: options.runner.id,
    artifactDir: options.artifactDir,
    report: result.report,
  });
  return result;
}

async function writeExplainArtifactIfNeeded(
  error: unknown,
  options: {
    suitePath: string;
    cwd: string;
    caseId: string;
    runnerId: string;
    artifactDir: string;
    report: SessionReport;
  },
): Promise<void> {
  const questions = getAttachedExplainQuestions(error);
  if (questions.length === 0) {
    return;
  }

  const explainArtifact: ExplainArtifact = {
    suitePath: options.suitePath,
    caseId: options.caseId,
    runnerId: options.runnerId,
    cwd: options.cwd,
    sessionId: options.report.sessionId,
    questions,
  };
  await writeJson(path.join(options.artifactDir, "explain.json"), explainArtifact);
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}
