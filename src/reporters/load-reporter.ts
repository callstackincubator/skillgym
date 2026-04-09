import path from "node:path";
import type { BenchmarkReporter } from "./contract.js";
import { createStandardReporter } from "./standard.js";
import { importFromPath } from "../utils/import.js";

const reporterHooks = new Set([
  "onSuiteStart",
  "onCaseStart",
  "onRunnerStart",
  "onRunnerFinish",
  "onCaseFinish",
  "onSuiteFinish",
  "onError",
]);

interface ImportedReporterModule {
  default?: unknown;
  reporter?: unknown;
}

export async function loadReporter(specifier: string | undefined, cwd: string): Promise<BenchmarkReporter> {
  if (specifier === undefined || specifier === "standard") {
    return createStandardReporter();
  }

  const resolvedPath = path.resolve(cwd, specifier);
  let imported: ImportedReporterModule;

  try {
    imported = await importFromPath<ImportedReporterModule>(resolvedPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load reporter module: ${resolvedPath}\n${reason}`);
  }

  const candidate = imported.default ?? imported.reporter;

  if (candidate === undefined) {
    throw new Error(
      `Reporter module must export a default reporter or named reporter object: ${resolvedPath}`,
    );
  }

  return validateReporter(candidate, resolvedPath);
}

function validateReporter(candidate: unknown, resolvedPath: string): BenchmarkReporter {
  if (typeof candidate !== "object" || candidate === null) {
    throw new Error(`Reporter module must export an object: ${resolvedPath}`);
  }

  const reporter = candidate as Record<string, unknown>;
  const hasHook = Array.from(reporterHooks).some((key) => typeof reporter[key] === "function");

  if (!hasHook) {
    throw new Error(
      `Reporter module must define at least one reporter hook (${Array.from(reporterHooks).join(", ")}): ${resolvedPath}`,
    );
  }

  return reporter as BenchmarkReporter;
}
