import path from "node:path";
import process from "node:process";
import type { RunnerFailureOrigin, RunnerResult } from "../domain/result.js";
import type { RunnerInfo } from "../domain/runner.js";
import type { SessionReport } from "../domain/session-report.js";
import type { Case, SuiteWorkspaceConfig, WorkspaceBootstrapConfig } from "../domain/case.js";
import { resolveFailureClass, type FailureClassInput } from "../failure-classification.js";
import { serializeError } from "../utils/error.js";
import {
  copyDir,
  ensureDir,
  ensureDirectoryExists,
  removeDir,
  writeJson,
  writeText,
} from "../utils/fs.js";
import { execFileCapture } from "../utils/process.js";

export interface ResolvedWorkspaceConfig {
  mode: "none" | "shared" | "isolated";
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
  case: Case;
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
  mode: "none" | "shared" | "isolated";
  workspacePath?: string;
  templateDir?: string;
  bootstrap?: BootstrapResult;
  cleanup(): Promise<{ preserved: boolean; cleanupError?: string }>;
}

export interface SharedWorkspaceSetupOptions {
  outputDir: string;
  artifactDir: string;
  timeoutMs: number;
}

export function resolveEffectiveWorkspace(options: WorkspaceSetupOptions): ResolvedWorkspaceConfig {
  const suiteWorkspace =
    options.suiteWorkspace === undefined
      ? undefined
      : resolveSuiteWorkspacePaths(options.suiteWorkspace, options.suiteDir);
  const configWorkspace = options.configWorkspace;
  const effective = suiteWorkspace ?? configWorkspace;

  if (effective === undefined) {
    return {
      mode: "none",
      cwd: options.baseCwd,
    };
  }

  if (effective.mode === "none") {
    return {
      mode: "none",
      cwd: effective.cwd ?? options.baseCwd,
    };
  }

  if (effective.mode === "shared") {
    return {
      mode: "shared",
      cwd: "",
      templateDir: effective.templateDir,
      bootstrap: effective.bootstrap,
    };
  }

  return {
    mode: "isolated",
    cwd: "",
    templateDir: effective.templateDir,
    bootstrap: effective.bootstrap,
  };
}

export function validateSuiteWorkspaceConfig(
  config: SuiteWorkspaceConfig,
  configPath = "workspace",
): void {
  if (config.mode === "none") {
    if (config.templateDir !== undefined) {
      throw new Error(
        `Invalid suite config at ${configPath}.templateDir: expected this key to be omitted when workspace mode is "none"`,
      );
    }

    if (config.bootstrap !== undefined) {
      throw new Error(
        `Invalid suite config at ${configPath}.bootstrap: expected this key to be omitted when workspace mode is "none"`,
      );
    }

    return;
  }

  if (config.mode === "shared") {
    if (config.cwd !== undefined) {
      throw new Error(
        `Invalid suite config at ${configPath}.cwd: expected this key to be omitted when workspace mode is "shared"`,
      );
    }

    return;
  }

  if (config.cwd !== undefined) {
    throw new Error(
      `Invalid suite config at ${configPath}.cwd: expected this key to be omitted when workspace mode is "isolated"`,
    );
  }
}

export async function prepareWorkspace(
  config: ResolvedWorkspaceConfig,
  options: ExecutionWorkspaceOptions,
): Promise<PreparedWorkspace> {
  if (config.mode === "none") {
    await writeWorkspaceMetadata(path.join(options.artifactDir, "workspace.json"), {
      mode: "none",
      cwd: config.cwd,
      templateDir: undefined,
      workspacePath: undefined,
      bootstrap: undefined,
      preserved: false,
      cleanupError: undefined,
    });

    return {
      cwd: config.cwd,
      mode: "none",
      async cleanup() {
        return { preserved: false };
      },
    };
  }

  if (config.mode === "shared") {
    throw new Error("Shared workspaces must be prepared once per suite run.");
  }

  const workspacePath = path.join(
    options.outputDir,
    "workspaces",
    sanitizePathSegment(options.case.id),
    options.runner.pathKey,
  );
  let bootstrap: BootstrapResult | undefined;

  try {
    await removeDir(workspacePath);

    if (config.templateDir !== undefined) {
      await ensureDirectoryExists(config.templateDir);
      await copyDir(config.templateDir, workspacePath);
    } else {
      await ensureDir(workspacePath);
    }

    bootstrap =
      config.bootstrap === undefined
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
  if (prepared.mode === "none" || prepared.mode === "shared") {
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

export async function prepareSharedWorkspace(
  config: ResolvedWorkspaceConfig,
  options: SharedWorkspaceSetupOptions,
): Promise<PreparedWorkspace> {
  if (config.mode !== "shared") {
    throw new Error(`Expected shared workspace config, received ${config.mode}`);
  }

  const workspacePath = getSharedWorkspacePath(options.outputDir);
  let bootstrap: BootstrapResult | undefined;

  try {
    await removeDir(workspacePath);

    if (config.templateDir !== undefined) {
      await ensureDirectoryExists(config.templateDir);
      await copyDir(config.templateDir, workspacePath);
    } else {
      await ensureDir(workspacePath);
    }

    bootstrap =
      config.bootstrap === undefined
        ? undefined
        : await runBootstrap(config.bootstrap, workspacePath, {
            artifactDir: options.artifactDir,
            outputDir: options.outputDir,
            timeoutMs: options.timeoutMs,
          });

    await writeWorkspaceMetadata(path.join(options.artifactDir, "workspace.json"), {
      mode: "shared",
      cwd: workspacePath,
      templateDir: config.templateDir,
      workspacePath,
      bootstrap,
      preserved: false,
      cleanupError: undefined,
    });

    return {
      cwd: workspacePath,
      mode: "shared",
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
      mode: "shared",
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

export async function writeExecutionWorkspaceMetadata(
  filePath: string,
  value: {
    mode: "none" | "shared" | "isolated";
    cwd: string;
    templateDir?: string;
    workspacePath?: string;
    bootstrap?: BootstrapResult;
    preserved: boolean;
    cleanupError?: string;
  },
): Promise<void> {
  await writeWorkspaceMetadata(filePath, value);
}

export function getSharedWorkspacePath(outputDir: string): string {
  return path.join(outputDir, "workspaces", "shared");
}

export function createExecutionFailureResult(
  error: unknown,
  options: {
    case: Case;
    runner: RunnerInfo;
    artifactDir: string;
    durationMs: number;
    failureOrigin?: RunnerFailureOrigin;
    failureClass?: FailureClassInput;
    failureLogPath?: string;
    report?: SessionReport;
  },
): RunnerResult {
  const serializedError = serializeError(error);
  const fallbackReport: SessionReport = options.report ?? {
    runner: options.runner,
    prompt: options.case.prompt,
    usage: {
      inputTokens: undefined,
      outputTokens: undefined,
      reasoningTokens: undefined,
      cacheTokens: undefined,
      totalTokens: undefined,
      inputChars: options.case.prompt.length,
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
    status: "failed",
    durationMs: options.durationMs,
    executionArtifactDir: options.artifactDir,
    artifactDir: options.artifactDir,
    report: fallbackReport,
    error: serializedError,
    failureOrigin: options.failureOrigin,
    failureClass: resolveFailureClass({
      failureClass: options.failureClass,
      failureOrigin: options.failureOrigin,
    }),
    failureLogPath: options.failureLogPath,
  };
}

function resolveSuiteWorkspacePaths(
  config: SuiteWorkspaceConfig,
  suiteDir: string,
): SuiteWorkspaceConfig {
  if (config.mode === "none") {
    return {
      mode: "none",
      cwd: config.cwd === undefined ? undefined : path.resolve(suiteDir, config.cwd),
    };
  }

  if (config.mode === "shared") {
    return {
      mode: "shared",
      templateDir:
        config.templateDir === undefined ? undefined : path.resolve(suiteDir, config.templateDir),
      bootstrap:
        config.bootstrap === undefined
          ? undefined
          : {
              command: resolvePathLikeValue(config.bootstrap.command, suiteDir),
              args: config.bootstrap.args?.map((arg) => resolvePathLikeValue(arg, suiteDir)),
              timeoutMs: config.bootstrap.timeoutMs,
              env: config.bootstrap.env === undefined ? undefined : { ...config.bootstrap.env },
            },
    };
  }

  return {
    mode: "isolated",
    templateDir:
      config.templateDir === undefined ? undefined : path.resolve(suiteDir, config.templateDir),
    bootstrap:
      config.bootstrap === undefined
        ? undefined
        : {
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
  options: Pick<ExecutionWorkspaceOptions, "artifactDir" | "outputDir" | "timeoutMs"> & {
    case?: Pick<Case, "id">;
    runner?: Pick<RunnerInfo, "id">;
  },
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
      ...(options.case === undefined ? {} : { SKILLGYM_CASE_ID: options.case.id }),
      ...(options.runner === undefined ? {} : { SKILLGYM_RUNNER_ID: options.runner.id }),
      SKILLGYM_OUTPUT_DIR: options.outputDir,
      SKILLGYM_ARTIFACT_DIR: options.artifactDir,
    },
  });

  await Promise.all([writeText(stdoutPath, result.stdout), writeText(stderrPath, result.stderr)]);

  if (result.exitCode !== 0) {
    throw new Error(
      `Workspace bootstrap failed: ${config.command} ${args.join(" ")} (exit ${String(result.exitCode)})`,
    );
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
    await writeText(
      path.join(options.artifactDir, "workspace.cleanup-error.log"),
      serialized.message,
    );
    return {
      preserved: true,
      cleanupError: serialized.message,
    };
  }
}

async function writeWorkspaceMetadata(
  filePath: string,
  value: {
    mode: "none" | "shared" | "isolated";
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
  return (
    value === "." ||
    value === ".." ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\") ||
    value.startsWith("/")
  );
}
