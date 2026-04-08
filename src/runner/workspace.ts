import path from "node:path";
import process from "node:process";
import type { RunnerFailureType, RunnerResult } from "../domain/result.ts";
import type { RunnerInfo } from "../domain/runner.ts";
import type { SessionReport } from "../domain/session-report.ts";
import type { SuiteWorkspaceConfig, TestCase, WorkspaceBootstrapConfig } from "../domain/test-case.ts";
import { serializeError } from "../utils/error.ts";
import { copyDir, ensureDir, ensureDirectoryExists, removeDir, writeJson, writeText } from "../utils/fs.ts";
import { execFileCapture } from "../utils/process.ts";

export interface ResolvedWorkspaceConfig {
  mode: "shared" | "isolated";
  cwd: string;
  templateDir?: string;
  bootstrap?: WorkspaceBootstrapConfig;
}

interface WorkspaceSetupOptions {
  baseCwd: string;
  suiteWorkspace?: SuiteWorkspaceConfig;
  configWorkspace?: SuiteWorkspaceConfig;
  suiteDir: string;
}

interface ExecutionWorkspaceOptions {
  artifactDir: string;
  outputDir: string;
  testCase: TestCase;
  runner: RunnerInfo;
  timeoutMs: number;
}

interface BootstrapResult {
  command: string;
  args: string[];
  durationMs: number;
  exitCode: number | null;
  stdoutPath: string;
  stderrPath: string;
}

export interface PreparedWorkspace {
  cwd: string;
  mode: "shared" | "isolated";
  workspacePath?: string;
  templateDir?: string;
  bootstrap?: BootstrapResult;
  cleanup(): Promise<{ preserved: boolean; cleanupError?: string }>;
}

export function resolveEffectiveWorkspace(options: WorkspaceSetupOptions): ResolvedWorkspaceConfig {
  const suiteWorkspace = options.suiteWorkspace === undefined
    ? undefined
    : resolveSuiteWorkspacePaths(options.suiteWorkspace, options.suiteDir);
  const configWorkspace = options.configWorkspace;
  const effective = suiteWorkspace ?? configWorkspace;

  if (effective === undefined) {
    return {
      mode: "shared",
      cwd: options.baseCwd,
    };
  }

  if (effective.mode === "shared") {
    return {
      mode: "shared",
      cwd: effective.cwd ?? options.baseCwd,
    };
  }

  return {
    mode: "isolated",
    cwd: "",
    templateDir: effective.templateDir,
    bootstrap: effective.bootstrap,
  };
}

export function validateSuiteWorkspaceConfig(config: SuiteWorkspaceConfig, configPath = "workspace"): void {
  if (config.mode === "shared") {
    if (config.templateDir !== undefined) {
      throw new Error(`Invalid suite config at ${configPath}.templateDir: expected this key to be omitted when workspace mode is "shared"`);
    }

    if (config.bootstrap !== undefined) {
      throw new Error(`Invalid suite config at ${configPath}.bootstrap: expected this key to be omitted when workspace mode is "shared"`);
    }

    return;
  }

  if (config.cwd !== undefined) {
    throw new Error(`Invalid suite config at ${configPath}.cwd: expected this key to be omitted when workspace mode is "isolated"`);
  }
}

export async function prepareWorkspace(
  config: ResolvedWorkspaceConfig,
  options: ExecutionWorkspaceOptions,
): Promise<PreparedWorkspace> {
  if (config.mode === "shared") {
    await writeWorkspaceMetadata(path.join(options.artifactDir, "workspace.json"), {
      mode: "shared",
      cwd: config.cwd,
      templateDir: undefined,
      workspacePath: undefined,
      bootstrap: undefined,
      preserved: false,
      cleanupError: undefined,
    });

    return {
      cwd: config.cwd,
      mode: "shared",
      async cleanup() {
        return { preserved: false };
      },
    };
  }

  const workspacePath = path.join(options.outputDir, "workspaces", sanitizePathSegment(options.testCase.id), options.runner.pathKey);
  let bootstrap: BootstrapResult | undefined;

  try {
    await removeDir(workspacePath);

    if (config.templateDir !== undefined) {
      await ensureDirectoryExists(config.templateDir);
      await copyDir(config.templateDir, workspacePath);
    } else {
      await ensureDir(workspacePath);
    }

    bootstrap = config.bootstrap === undefined
      ? undefined
      : await runBootstrap(config.bootstrap, workspacePath, options);

    await writeWorkspaceMetadata(path.join(options.artifactDir, "workspace.json"), {
      mode: "isolated",
      cwd: workspacePath,
      templateDir: config.templateDir,
      workspacePath,
      bootstrap,
      preserved: false,
      cleanupError: undefined,
    });

    return {
      cwd: workspacePath,
      mode: "isolated",
      workspacePath,
      templateDir: config.templateDir,
      bootstrap,
      async cleanup() {
        return cleanupWorkspace({
          artifactDir: options.artifactDir,
          workspacePath,
        });
      },
    };
  } catch (error) {
    await writeWorkspaceMetadata(path.join(options.artifactDir, "workspace.json"), {
      mode: "isolated",
      cwd: workspacePath,
      templateDir: config.templateDir,
      workspacePath,
      bootstrap,
      preserved: true,
      cleanupError: serializeError(error).message,
    });
    throw error;
  }
}

export async function finalizeWorkspace(
  prepared: PreparedWorkspace,
  options: {
    artifactDir: string;
    passed: boolean;
  },
): Promise<void> {
  if (prepared.mode === "shared") {
    return;
  }

  const cleanupResult = options.passed ? await prepared.cleanup() : { preserved: true };
  const metadataPath = path.join(options.artifactDir, "workspace.json");
  const bootstrap = prepared.bootstrap;

  await writeWorkspaceMetadata(metadataPath, {
    mode: prepared.mode,
    cwd: prepared.cwd,
    templateDir: prepared.templateDir,
    workspacePath: prepared.workspacePath,
    bootstrap,
    preserved: cleanupResult.preserved,
    cleanupError: cleanupResult.cleanupError,
  });
}

export function createExecutionFailureResult(
  error: unknown,
  options: {
    testCase: TestCase;
    runner: RunnerInfo;
    artifactDir: string;
    durationMs: number;
    failureType?: RunnerFailureType;
    report?: SessionReport;
  },
): RunnerResult {
  const serializedError = serializeError(error);
  const fallbackReport: SessionReport = options.report ?? {
    runner: options.runner,
    prompt: options.testCase.prompt,
    usage: {
      totalTokens: undefined,
      completionTokens: undefined,
      inputChars: options.testCase.prompt.length,
      outputChars: 0,
      reasoningChars: 0,
      source: {
        input: "chars",
        output: "chars",
        reasoning: "chars",
      },
    },
    files: {
      observedReads: [],
      observedSkillReads: [],
    },
    detectedSkills: [],
    events: [],
    finalOutput: "",
    rawArtifacts: {},
  };

  return {
    runner: options.runner,
    passed: false,
    durationMs: options.durationMs,
    artifactDir: options.artifactDir,
    report: fallbackReport,
    error: serializedError,
    failureType: options.failureType ?? "runner-crash",
  };
}

function resolveSuiteWorkspacePaths(config: SuiteWorkspaceConfig, suiteDir: string): SuiteWorkspaceConfig {
  if (config.mode === "shared") {
    return {
      mode: "shared",
      cwd: config.cwd === undefined ? undefined : path.resolve(suiteDir, config.cwd),
    };
  }

  return {
    mode: "isolated",
    templateDir: config.templateDir === undefined ? undefined : path.resolve(suiteDir, config.templateDir),
    bootstrap: config.bootstrap === undefined ? undefined : {
      command: resolvePathLikeValue(config.bootstrap.command, suiteDir),
      args: config.bootstrap.args?.map((arg) => resolvePathLikeValue(arg, suiteDir)),
      timeoutMs: config.bootstrap.timeoutMs,
      env: config.bootstrap.env === undefined ? undefined : { ...config.bootstrap.env },
    },
  };
}

async function runBootstrap(
  config: WorkspaceBootstrapConfig,
  workspacePath: string,
  options: ExecutionWorkspaceOptions,
): Promise<BootstrapResult> {
  const stdoutPath = path.join(options.artifactDir, "bootstrap.stdout.log");
  const stderrPath = path.join(options.artifactDir, "bootstrap.stderr.log");
  const args = config.args ?? [];
  const startedMs = Date.now();
  const result = await execFileCapture(config.command, args, {
    cwd: workspacePath,
    timeoutMs: Math.max(1, config.timeoutMs ?? options.timeoutMs),
    env: {
      ...process.env,
      ...config.env,
      SKILLGYM_WORKSPACE: workspacePath,
      SKILLGYM_CASE_ID: options.testCase.id,
      SKILLGYM_RUNNER_ID: options.runner.id,
      SKILLGYM_OUTPUT_DIR: options.outputDir,
      SKILLGYM_ARTIFACT_DIR: options.artifactDir,
    },
  });

  await Promise.all([
    writeText(stdoutPath, result.stdout),
    writeText(stderrPath, result.stderr),
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Workspace bootstrap failed: ${config.command} ${args.join(" ")} (exit ${String(result.exitCode)})`);
  }

  return {
    command: config.command,
    args,
    durationMs: Date.now() - startedMs,
    exitCode: result.exitCode,
    stdoutPath,
    stderrPath,
  };
}

async function cleanupWorkspace(options: {
  artifactDir: string;
  workspacePath: string;
}): Promise<{ preserved: boolean; cleanupError?: string }> {
  try {
    await removeDir(options.workspacePath);
    return { preserved: false };
  } catch (error) {
    const serialized = serializeError(error);
    await writeText(path.join(options.artifactDir, "workspace.cleanup-error.log"), serialized.message);
    return {
      preserved: true,
      cleanupError: serialized.message,
    };
  }
}

async function writeWorkspaceMetadata(
  filePath: string,
  value: {
    mode: "shared" | "isolated";
    cwd: string;
    templateDir?: string;
    workspacePath?: string;
    bootstrap?: BootstrapResult;
    preserved: boolean;
    cleanupError?: string;
  },
): Promise<void> {
  await writeJson(filePath, value);
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function resolvePathLikeValue(value: string, configDir: string): string {
  if (path.isAbsolute(value) || !looksPathLike(value)) {
    return value;
  }

  return path.resolve(configDir, value);
}

function looksPathLike(value: string): boolean {
  return value === "."
    || value === ".."
    || value.startsWith("./")
    || value.startsWith("../")
    || value.startsWith(".\\")
    || value.startsWith("..\\")
    || value.startsWith("/");
}
