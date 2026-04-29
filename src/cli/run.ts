import path from "node:path";
import { loadConfig, resolveReporterOptions, resolveRunOptions } from "../config.js";
import { loadReporter } from "../reporters/index.js";
import { createSnapshotRuntimeOptions } from "../snapshots/store.js";
import { executeSuite } from "../runner/execute-suite.js";
import { loadSuite } from "../runner/load-suite.js";
import { resolveEffectiveWorkspace } from "../runner/workspace.js";

export class RunFailuresError extends Error {
  constructor() {
    super("One or more runs failed.");
    this.name = "RunFailuresError";
  }
}

export async function runCommand(options: {
  suitePath: string;
  cwd?: string;
  outputDir?: string;
  schedule?: string;
  maxParallel?: string;
  caseId?: string;
  runner?: string;
  reporter?: string;
  reporterCwd?: string;
  configPath?: string;
  updateSnapshots?: boolean;
  snapshotsPath?: string;
  tags?: string[];
}): Promise<void> {
  const loadedConfig = await loadConfig({
    suitePath: options.suitePath,
    configPath: options.configPath,
  });
  const runOptions = resolveRunOptions(
    {
      cwd: options.cwd,
      outputDir: options.outputDir,
      schedule: options.schedule,
      maxParallel: options.maxParallel,
      tags: options.tags,
    },
    loadedConfig.config,
  );
  const reporterOptions = resolveReporterOptions(
    {
      reporter: options.reporter,
      cwd: options.reporterCwd,
    },
    loadedConfig,
  );
  const suite = await loadSuite(options.suitePath);
  const effectiveWorkspace = resolveEffectiveWorkspace({
    baseCwd: path.resolve(runOptions.cwd),
    suiteWorkspace: suite.workspace,
    configWorkspace: loadedConfig.config.run?.workspace,
    suiteDir: suite.dirPath,
  });

  if (options.cwd !== undefined && effectiveWorkspace.mode === "isolated") {
    throw new Error(
      "CLI option --cwd is only supported when the effective workspace mode is shared.",
    );
  }

  const reporter = await loadReporter(reporterOptions.reporter, reporterOptions.cwd);
  const snapshots = createSnapshotRuntimeOptions({
    snapshotConfig: loadedConfig.config.snapshots,
    updateSnapshots: options.updateSnapshots,
    snapshotPath: options.snapshotsPath,
    configPath: loadedConfig.filePath,
  });

  const result = await executeSuite(options.suitePath, suite.cases, {
    cwd: path.resolve(runOptions.cwd),
    outputDir: runOptions.outputDir,
    schedule: runOptions.schedule,
    maxParallel: runOptions.maxParallel,
    caseId: options.caseId,
    runner: options.runner,
    tags: runOptions.tags,
    config: loadedConfig.config,
    suiteWorkspace: suite.workspace,
    snapshots,
    reporter,
  });

  if (
    result.cases.some((caseResult) =>
      caseResult.runnerResults.some((runnerResult) => !runnerResult.passed),
    )
  ) {
    throw new RunFailuresError();
  }
}
