import { readdir } from "node:fs/promises";
import path from "node:path";
import type { RunnerConfig } from "./domain/runner.js";
import type { SuiteWorkspaceConfig, WorkspaceBootstrapConfig } from "./domain/test-case.js";
import { SCHEDULE_MODES, type ScheduleMode } from "./domain/schedule.js";
import { importFromPath } from "./utils/import.js";

const CONFIG_FILENAMES = [
  "skillgym.config.ts",
  "skillgym.config.mts",
  "skillgym.config.cts",
  "skillgym.config.js",
  "skillgym.config.mjs",
  "skillgym.config.cjs",
] as const;

const TOP_LEVEL_KEYS = ["run", "defaults", "runners", "snapshots"] as const;
const RUN_KEYS = ["cwd", "outputDir", "reporter", "schedule", "workspace"] as const;
const DEFAULT_KEYS = ["timeoutMs"] as const;
const RUNNER_KEYS = ["agent"] as const;
const COMMON_AGENT_KEYS = ["type", "command", "commandArgs", "env", "model"] as const;
const CODEX_AGENT_KEYS = [...COMMON_AGENT_KEYS] as const;
const SNAPSHOT_KEYS = ["path", "metric", "tolerance"] as const;
const SNAPSHOT_TOLERANCE_KEYS = ["absolute", "percent"] as const;
const WORKSPACE_KEYS = ["mode", "cwd", "templateDir", "bootstrap"] as const;
const BOOTSTRAP_KEYS = ["command", "args", "timeoutMs", "env"] as const;

export const SNAPSHOT_METRICS = [
  "totalTokens",
  "inputTokens",
  "outputTokens",
  "reasoningTokens",
  "completionTokens",
] as const;

export type SnapshotMetric = typeof SNAPSHOT_METRICS[number];

export interface SnapshotToleranceConfig {
  absolute?: number;
  percent?: number;
}

export interface SnapshotConfig {
  path?: string;
  metric?: SnapshotMetric;
  tolerance: SnapshotToleranceConfig;
}

export interface SkillGymConfig {
  run?: {
    cwd?: string;
    outputDir?: string;
    reporter?: string;
    schedule?: ScheduleMode;
    workspace?: SuiteWorkspaceConfig;
  };
  defaults?: {
    timeoutMs?: number;
  };
  runners: Record<string, RunnerConfig>;
  snapshots?: SnapshotConfig;
}

export interface LoadedSkillGymConfig {
  filePath?: string;
  config: SkillGymConfig;
}

export async function loadConfig(options: {
  suitePath: string;
  configPath?: string;
}): Promise<LoadedSkillGymConfig> {
  const filePath = options.configPath !== undefined
    ? path.resolve(options.configPath)
    : await discoverConfigPath(path.dirname(path.resolve(options.suitePath)));

  if (filePath === undefined) {
    throw new Error("No skillgym config found. Create skillgym.config.ts with a non-empty runners map.");
  }

  const imported = await importFromPath<unknown>(filePath);
  const rawConfig = readConfigModule(imported);
  const parsed = parseConfig(rawConfig);

  return {
    filePath,
    config: resolveConfigPaths(parsed, path.dirname(filePath)),
  };
}

export function parseConfig(raw: unknown): SkillGymConfig {
  const record = parseObject(raw, undefined);
  ensureKnownKeys(record, TOP_LEVEL_KEYS, undefined);

  return {
    run: parseRunConfig(record.run, "run"),
    defaults: parseDefaultsConfig(record.defaults, "defaults"),
    runners: parseRunnersConfig(record.runners, "runners"),
    snapshots: parseSnapshotConfig(record.snapshots, "snapshots"),
  };
}

export function resolveRunOptions(
  cliOptions: {
    cwd?: string;
    outputDir?: string;
    schedule?: string;
  },
  config: SkillGymConfig,
): {
  cwd: string;
  outputDir?: string;
  schedule: ScheduleMode;
} {
  return {
    cwd: cliOptions.cwd !== undefined ? path.resolve(cliOptions.cwd) : config.run?.cwd ?? process.cwd(),
    outputDir: cliOptions.outputDir !== undefined ? path.resolve(cliOptions.outputDir) : config.run?.outputDir,
    schedule: cliOptions.schedule !== undefined
      ? parseScheduleMode(cliOptions.schedule, "CLI option --schedule")
      : config.run?.schedule ?? "serial",
  };
}

export function resolveReporterOptions(
  cliOptions: {
    reporter?: string;
    cwd?: string;
  },
  loadedConfig: LoadedSkillGymConfig,
): {
  reporter?: string;
  cwd: string;
} {
  if (cliOptions.reporter !== undefined) {
    return {
      reporter: cliOptions.reporter,
      cwd: cliOptions.cwd ?? process.cwd(),
    };
  }

  return {
    reporter: loadedConfig.config.run?.reporter,
    cwd: loadedConfig.filePath === undefined ? process.cwd() : path.dirname(loadedConfig.filePath),
  };
}

export function getCaseExecutionOptions(
  testCase: { timeoutMs?: number },
  config: SkillGymConfig,
): {
  timeoutMs: number;
} {
  return {
    timeoutMs: testCase.timeoutMs ?? config.defaults?.timeoutMs ?? 120_000,
  };
}

async function discoverConfigPath(startDir: string): Promise<string | undefined> {
  let currentDir = path.resolve(startDir);

  while (true) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    const matches = entries
      .filter((entry) => entry.isFile() && CONFIG_FILENAMES.includes(entry.name as typeof CONFIG_FILENAMES[number]))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    if (matches.length > 1) {
      throw new Error(`Multiple config files found in ${currentDir}: ${matches.join(", ")}`);
    }

    if (matches.length === 1) {
      const match = matches[0];
      if (match === undefined) {
        return undefined;
      }

      return path.join(currentDir, match);
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
}

function readConfigModule(imported: unknown): unknown {
  if (isPlainObject(imported) && "default" in imported) {
    return imported.default;
  }

  return imported;
}

function resolveConfigPaths(config: SkillGymConfig, configDir: string): SkillGymConfig {
  return {
    run: config.run === undefined ? undefined : {
      cwd: config.run.cwd === undefined ? undefined : path.resolve(configDir, config.run.cwd),
      outputDir: config.run.outputDir === undefined ? undefined : path.resolve(configDir, config.run.outputDir),
      reporter: config.run.reporter === undefined ? undefined : resolveReporterSpecifier(config.run.reporter, configDir),
      schedule: config.run.schedule,
      workspace: config.run.workspace === undefined ? undefined : resolveWorkspaceConfigPaths(config.run.workspace, configDir),
    },
    defaults: config.defaults === undefined ? undefined : {
      timeoutMs: config.defaults.timeoutMs,
    },
    runners: Object.fromEntries(
      Object.entries(config.runners).map(([id, runner]) => [id, resolveRunnerConfigPaths(runner, configDir)]),
    ),
    snapshots: config.snapshots === undefined ? undefined : {
      path: config.snapshots.path === undefined ? undefined : path.resolve(configDir, config.snapshots.path),
      metric: config.snapshots.metric,
      tolerance: {
        absolute: config.snapshots.tolerance.absolute,
        percent: config.snapshots.tolerance.percent,
      },
    },
  };
}

function resolveRunnerConfigPaths(config: RunnerConfig, configDir: string): RunnerConfig {
  if (config.agent.type === "codex") {
    return {
      agent: {
        ...resolveCommonAgentPaths(config.agent, configDir),
        type: "codex",
      },
    };
  }

  return {
    agent: {
      ...resolveCommonAgentPaths(config.agent, configDir),
      type: "opencode",
    },
  };
}

function resolveCommonAgentPaths(
  config: RunnerConfig["agent"],
  configDir: string,
): Omit<RunnerConfig["agent"], "type"> {
  return {
    command: config.command === undefined ? undefined : resolvePathLikeValue(config.command, configDir),
    commandArgs: config.commandArgs?.map((arg) => resolvePathLikeValue(arg, configDir)),
    env: config.env === undefined ? undefined : { ...config.env },
    model: config.model,
  };
}

function resolvePathLikeValue(value: string, configDir: string): string {
  if (path.isAbsolute(value) || !looksPathLike(value)) {
    return value;
  }

  return path.resolve(configDir, value);
}

function resolveReporterSpecifier(value: string, configDir: string): string {
  if (value === "standard" || path.isAbsolute(value)) {
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
    || value.startsWith("..\\");
}

function parseRunConfig(value: unknown, configPath: string): SkillGymConfig["run"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = parseObject(value, configPath);
  ensureKnownKeys(record, RUN_KEYS, configPath);

  return {
    cwd: parseOptionalNonEmptyString(record.cwd, `${configPath}.cwd`),
    outputDir: parseOptionalNonEmptyString(record.outputDir, `${configPath}.outputDir`),
    reporter: parseOptionalNonEmptyString(record.reporter, `${configPath}.reporter`),
    schedule: parseOptionalScheduleMode(record.schedule, `${configPath}.schedule`),
    workspace: parseOptionalWorkspaceConfig(record.workspace, `${configPath}.workspace`),
  };
}

function parseOptionalWorkspaceConfig(value: unknown, configPath: string): SuiteWorkspaceConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  return parseWorkspaceConfig(value, configPath);
}

function parseWorkspaceConfig(value: unknown, configPath: string): SuiteWorkspaceConfig {
  const record = parseObject(value, configPath);
  ensureKnownKeys(record, WORKSPACE_KEYS, configPath);

  const mode = parseWorkspaceMode(record.mode, `${configPath}.mode`);
  const cwd = parseOptionalNonEmptyString(record.cwd, `${configPath}.cwd`);
  const templateDir = parseOptionalNonEmptyString(record.templateDir, `${configPath}.templateDir`);
  const bootstrap = parseOptionalBootstrapConfig(record.bootstrap, `${configPath}.bootstrap`);

  if (mode === "shared") {
    if (templateDir !== undefined) {
      throw invalidConfig(`${configPath}.templateDir`, 'expected this key to be omitted when workspace mode is "shared"');
    }

    if (bootstrap !== undefined) {
      throw invalidConfig(`${configPath}.bootstrap`, 'expected this key to be omitted when workspace mode is "shared"');
    }

    return {
      mode,
      cwd,
    };
  }

  if (cwd !== undefined) {
    throw invalidConfig(`${configPath}.cwd`, 'expected this key to be omitted when workspace mode is "isolated"');
  }

  return {
    mode,
    templateDir,
    bootstrap,
  };
}

function parseWorkspaceMode(value: unknown, configPath: string): SuiteWorkspaceConfig["mode"] {
  if (value !== "shared" && value !== "isolated") {
    throw invalidConfig(configPath, 'expected "shared" or "isolated"');
  }

  return value;
}

function parseOptionalBootstrapConfig(value: unknown, configPath: string): WorkspaceBootstrapConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = parseObject(value, configPath);
  ensureKnownKeys(record, BOOTSTRAP_KEYS, configPath);

  return {
    command: parseRequiredNonEmptyString(record.command, `${configPath}.command`),
    args: parseOptionalStringArray(record.args, `${configPath}.args`),
    timeoutMs: parseOptionalInteger(record.timeoutMs, `${configPath}.timeoutMs`, 1, { inclusive: false }),
    env: parseOptionalEnv(record.env, `${configPath}.env`),
  };
}

function parseOptionalScheduleMode(value: unknown, configPath: string): ScheduleMode | undefined {
  if (value === undefined) {
    return undefined;
  }

  return parseScheduleMode(value, configPath);
}

function parseScheduleMode(value: unknown, configPath: string): ScheduleMode {
  if (typeof value !== "string" || !SCHEDULE_MODES.includes(value as ScheduleMode)) {
    throw invalidConfig(configPath, `expected one of: ${SCHEDULE_MODES.join(", ")}`);
  }

  return value as ScheduleMode;
}

function parseDefaultsConfig(value: unknown, configPath: string): SkillGymConfig["defaults"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = parseObject(value, configPath);
  ensureKnownKeys(record, DEFAULT_KEYS, configPath);

  return {
    timeoutMs: parseOptionalInteger(record.timeoutMs, `${configPath}.timeoutMs`, 1, { inclusive: false }),
  };
}

function parseSnapshotConfig(value: unknown, configPath: string): SkillGymConfig["snapshots"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = parseObject(value, configPath);
  ensureKnownKeys(record, SNAPSHOT_KEYS, configPath);

  const tolerance = parseSnapshotTolerance(record.tolerance, `${configPath}.tolerance`);

  return {
    path: parseOptionalNonEmptyString(record.path, `${configPath}.path`),
    metric: parseOptionalSnapshotMetric(record.metric, `${configPath}.metric`),
    tolerance,
  };
}

function parseRunnersConfig(value: unknown, configPath: string): SkillGymConfig["runners"] {
  const record = parseObject(value, configPath);

  if (Object.keys(record).length === 0) {
    throw invalidConfig(configPath, "expected non-empty object");
  }

  return Object.fromEntries(
    Object.entries(record).map(([runnerId, runnerValue]) => [runnerId, parseRunnerConfig(runnerValue, `${configPath}.${runnerId}`)]),
  );
}

function parseRunnerConfig(value: unknown, configPath: string): RunnerConfig {
  const record = parseObject(value, configPath);
  ensureKnownKeys(record, RUNNER_KEYS, configPath);

  return {
    agent: parseAgentConfig(record.agent, `${configPath}.agent`),
  };
}

function parseAgentConfig(value: unknown, configPath: string): RunnerConfig["agent"] {
  const record = parseObject(value, configPath);
  const type = parseRequiredAgentType(record.type, `${configPath}.type`);

  ensureKnownKeys(record, type === "codex" ? CODEX_AGENT_KEYS : COMMON_AGENT_KEYS, configPath);

  if (type === "codex") {
    return {
      type,
      command: parseOptionalNonEmptyString(record.command, `${configPath}.command`),
      commandArgs: parseOptionalStringArray(record.commandArgs, `${configPath}.commandArgs`),
      env: parseOptionalEnv(record.env, `${configPath}.env`),
      model: parseRequiredNonEmptyString(record.model, `${configPath}.model`),
    };
  }

  return {
    type,
    command: parseOptionalNonEmptyString(record.command, `${configPath}.command`),
    commandArgs: parseOptionalStringArray(record.commandArgs, `${configPath}.commandArgs`),
    env: parseOptionalEnv(record.env, `${configPath}.env`),
    model: parseRequiredNonEmptyString(record.model, `${configPath}.model`),
  };
}

function parseRequiredAgentType(value: unknown, configPath: string): "codex" | "opencode" {
  if (value !== "codex" && value !== "opencode") {
    throw invalidConfig(configPath, 'expected "codex" or "opencode"');
  }

  return value;
}

function parseOptionalNonEmptyString(value: unknown, configPath: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidConfig(configPath, "expected non-empty string");
  }

  return value;
}

function parseRequiredNonEmptyString(value: unknown, configPath: string): string {
  const parsed = parseOptionalNonEmptyString(value, configPath);

  if (parsed === undefined) {
    throw invalidConfig(configPath, "expected non-empty string");
  }

  return parsed;
}

function resolveWorkspaceConfigPaths(config: SuiteWorkspaceConfig, configDir: string): SuiteWorkspaceConfig {
  if (config.mode === "shared") {
    return {
      mode: "shared",
      cwd: config.cwd === undefined ? undefined : path.resolve(configDir, config.cwd),
    };
  }

  return {
    mode: "isolated",
    templateDir: config.templateDir === undefined ? undefined : path.resolve(configDir, config.templateDir),
    bootstrap: config.bootstrap === undefined ? undefined : resolveBootstrapConfigPaths(config.bootstrap, configDir),
  };
}

function resolveBootstrapConfigPaths(config: WorkspaceBootstrapConfig, configDir: string): WorkspaceBootstrapConfig {
  return {
    command: resolvePathLikeValue(config.command, configDir),
    args: config.args?.map((arg) => resolvePathLikeValue(arg, configDir)),
    timeoutMs: config.timeoutMs,
    env: config.env === undefined ? undefined : { ...config.env },
  };
}

function parseOptionalStringArray(value: unknown, configPath: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw invalidConfig(configPath, "expected array of non-empty strings");
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw invalidConfig(`${configPath}[${String(index)}]`, "expected non-empty string");
    }

    return item;
  });
}

function parseOptionalEnv(value: unknown, configPath: string): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = parseObject(value, configPath);
  const env: Record<string, string> = {};

  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== "string") {
      throw invalidConfig(`${configPath}.${key}`, "expected string");
    }

    env[key] = item;
  }

  return env;
}

function parseOptionalInteger(
  value: unknown,
  configPath: string,
  minimum: number,
  options: { inclusive: boolean } = { inclusive: true },
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw invalidConfig(configPath, options.inclusive
      ? `expected integer >= ${String(minimum)}`
      : `expected integer > ${String(minimum)}`);
  }

  if (options.inclusive ? value < minimum : value <= minimum) {
    throw invalidConfig(configPath, options.inclusive
      ? `expected integer >= ${String(minimum)}`
      : `expected integer > ${String(minimum)}`);
  }

  return value;
}

function parseOptionalSnapshotMetric(value: unknown, configPath: string): SnapshotMetric | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !SNAPSHOT_METRICS.includes(value as SnapshotMetric)) {
    throw invalidConfig(configPath, `expected one of: ${SNAPSHOT_METRICS.join(", ")}`);
  }

  return value as SnapshotMetric;
}

function parseSnapshotTolerance(value: unknown, configPath: string): SnapshotToleranceConfig {
  const record = parseObject(value, configPath);
  ensureKnownKeys(record, SNAPSHOT_TOLERANCE_KEYS, configPath);

  const absolute = parseOptionalNumber(record.absolute, `${configPath}.absolute`, 0);
  const percent = parseOptionalNumber(record.percent, `${configPath}.percent`, 0);

  if (absolute === undefined && percent === undefined) {
    throw invalidConfig(configPath, "expected at least one of absolute or percent");
  }

  return { absolute, percent };
}

function parseOptionalNumber(value: unknown, configPath: string, minimum: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw invalidConfig(configPath, `expected number >= ${String(minimum)}`);
  }

  return value;
}

function parseObject(value: unknown, configPath: string | undefined): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw invalidConfig(configPath, "expected plain object");
  }

  return value;
}

function ensureKnownKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  configPath: string | undefined,
): void {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) {
      const fullPath = configPath === undefined ? key : `${configPath}.${key}`;
      throw new Error(`Unknown config key: ${fullPath}`);
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidConfig(configPath: string | undefined, message: string): Error {
  return new Error(configPath === undefined
    ? `Invalid config: ${message}`
    : `Invalid config at ${configPath}: ${message}`);
}
