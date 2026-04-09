import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SnapshotConfig, SnapshotMetric } from "../config.js";
import type { RunnerInfo } from "../domain/runner.js";
import { writeJson } from "../utils/fs.js";
import { nowIso } from "../utils/time.js";

export interface SnapshotEntry {
  caseId: string;
  runnerId: string;
  metric: SnapshotMetric;
  value: number;
  agentType: RunnerInfo["agent"]["type"];
  model?: string;
  updatedAt: string;
}

interface SnapshotFile {
  version: 1;
  entries: Record<string, SnapshotEntry>;
}

export interface SnapshotRuntimeOptions {
  enabled: boolean;
  updateSnapshots: boolean;
  path: string;
  config: SnapshotConfig;
}

export interface SnapshotCheckInput {
  caseId: string;
  runner: RunnerInfo;
  actual: number;
}

export interface SnapshotCheckResult {
  created: boolean;
  updated: boolean;
}

export class SnapshotStore {
  private readonly entries = new Map<string, SnapshotEntry>();
  private dirty = false;

  private constructor(
    private readonly filePath: string,
    private readonly config: SnapshotConfig,
  ) {}

  static async load(options: SnapshotRuntimeOptions | undefined): Promise<SnapshotStore | undefined> {
    if (options === undefined || !options.enabled) {
      return undefined;
    }

    const store = new SnapshotStore(options.path, options.config);

    try {
      const raw = await readFile(options.path, "utf8");
      const parsed = JSON.parse(raw) as SnapshotFile;
      if (parsed.version !== 1 || typeof parsed.entries !== "object" || parsed.entries === null) {
        throw new Error("Snapshot file must contain version 1 and an entries object.");
      }

      for (const [key, entry] of Object.entries(parsed.entries)) {
        store.entries.set(key, entry);
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError?.code !== "ENOENT") {
        throw new Error(`Failed to load snapshots from ${options.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return store;
  }

  async save(): Promise<void> {
    if (!this.dirty) {
      return;
    }

    const payload: SnapshotFile = {
      version: 1,
      entries: Object.fromEntries([...this.entries.entries()].sort(([left], [right]) => left.localeCompare(right))),
    };

    await writeJson(this.filePath, payload);
    this.dirty = false;
  }

  check(input: SnapshotCheckInput, options: SnapshotRuntimeOptions): SnapshotCheckResult {
    const key = createSnapshotKey(input.caseId, input.runner.id);
    const existing = this.entries.get(key);

    if (existing === undefined) {
      this.entries.set(key, createSnapshotEntry(input.caseId, input.runner, this.config.metric ?? "totalTokens", input.actual));
      this.dirty = true;
      return { created: true, updated: false };
    }

    if (options.updateSnapshots) {
      this.entries.set(key, createSnapshotEntry(input.caseId, input.runner, this.config.metric ?? "totalTokens", input.actual));
      this.dirty = true;
      return { created: false, updated: true };
    }

    assertWithinTolerance(existing, input.actual, this.config.tolerance);
    return { created: false, updated: false };
  }

  getFilePath(): string {
    return this.filePath;
  }
}

export function createSnapshotRuntimeOptions(options: {
  snapshotConfig?: SnapshotConfig;
  updateSnapshots?: boolean;
  snapshotPath?: string;
  configPath?: string;
}): SnapshotRuntimeOptions | undefined {
  if (options.snapshotConfig === undefined) {
    return undefined;
  }

  const filePath = options.snapshotPath
    ?? options.snapshotConfig.path
    ?? path.resolve(options.configPath === undefined ? process.cwd() : path.dirname(options.configPath), "skillgym.snapshots.json");

  return {
    enabled: true,
    updateSnapshots: options.updateSnapshots ?? false,
    path: filePath,
    config: {
      path: options.snapshotConfig.path,
      metric: options.snapshotConfig.metric ?? "totalTokens",
      tolerance: {
        absolute: options.snapshotConfig.tolerance.absolute,
        percent: options.snapshotConfig.tolerance.percent,
      },
    },
  };
}

export function createSnapshotKey(caseId: string, runnerId: string): string {
  return `${caseId}::${runnerId}`;
}

function createSnapshotEntry(
  caseId: string,
  runner: RunnerInfo,
  metric: SnapshotMetric,
  value: number,
): SnapshotEntry {
  return {
    caseId,
    runnerId: runner.id,
    metric,
    value,
    agentType: runner.agent.type,
    model: runner.agent.model,
    updatedAt: nowIso(),
  };
}

function assertWithinTolerance(
  baseline: SnapshotEntry,
  actual: number,
  tolerance: SnapshotConfig["tolerance"],
): void {
  const absoluteLimit = tolerance.absolute === undefined ? undefined : baseline.value + tolerance.absolute;
  const percentLimit = tolerance.percent === undefined ? undefined : baseline.value * (1 + tolerance.percent / 100);

  if (absoluteLimit !== undefined && actual > absoluteLimit) {
    throw createSnapshotError(baseline, actual, absoluteLimit);
  }

  if (percentLimit !== undefined && actual > percentLimit) {
    throw createSnapshotError(baseline, actual, percentLimit);
  }
}

function createSnapshotError(baseline: SnapshotEntry, actual: number, allowed: number): Error {
  const delta = actual - baseline.value;
  const percent = baseline.value === 0 ? 0 : (delta / baseline.value) * 100;
  return new Error(
    [
      `Snapshot mismatch for ${baseline.metric}:`,
      `actual ${formatNumber(actual)} > allowed ${formatNumber(allowed)}`,
      `baseline ${formatNumber(baseline.value)}, +${formatNumber(delta)} tokens (+${percent.toFixed(1)}%)`,
      `key: ${baseline.caseId} / ${baseline.runnerId}`,
      "Run with --update-snapshots to accept the new baseline.",
    ].join("\n"),
  );
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
