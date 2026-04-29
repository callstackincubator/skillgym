import path from "node:path";
import type { SuiteWorkspaceConfig, TestCase, TestSuite } from "../domain/test-case.js";
import { importFromPath } from "../utils/import.js";
import { validateSuiteWorkspaceConfig } from "./workspace.js";

interface ImportedSuite {
  default?: TestSuite;
  workspace?: SuiteWorkspaceConfig;
}

export interface LoadedSuite {
  filePath: string;
  dirPath: string;
  cases: TestCase[];
  workspace?: SuiteWorkspaceConfig;
}

export async function loadSuite(filePath: string): Promise<LoadedSuite> {
  const absolutePath = path.resolve(filePath);
  const imported = await importFromPath<ImportedSuite>(absolutePath);
  const suite = imported.default;

  if (suite === undefined) {
    throw new Error(`Suite file does not have a default export: ${absolutePath}`);
  }

  if (Array.isArray(suite)) {
    if (imported.workspace !== undefined) {
      validateSuiteWorkspaceConfig(imported.workspace);
    }

    return {
      filePath: absolutePath,
      dirPath: path.dirname(absolutePath),
      cases: normalizeTestCases(suite),
      workspace: imported.workspace,
    };
  }

  if (imported.workspace !== undefined) {
    validateSuiteWorkspaceConfig(imported.workspace);
  }

  return {
    filePath: absolutePath,
    dirPath: path.dirname(absolutePath),
    cases: normalizeTestCases(Object.values(suite)),
    workspace: imported.workspace,
  };
}

function normalizeTestCases(cases: TestCase[]): TestCase[] {
  return cases.map((testCase) => ({
    ...testCase,
    tags: normalizeTags(testCase.tags, `case ${testCase.id}`),
  }));
}

function normalizeTags(tags: string[] | undefined, label: string): string[] {
  if (tags === undefined) {
    return [];
  }

  if (!Array.isArray(tags)) {
    throw new Error(`Invalid tags for ${label}: expected array of non-empty strings`);
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const [index, tag] of tags.entries()) {
    if (typeof tag !== "string" || tag.trim().length === 0) {
      throw new Error(
        `Invalid tag for ${label} at index ${String(index)}: expected non-empty string`,
      );
    }

    if (!seen.has(tag)) {
      seen.add(tag);
      normalized.push(tag);
    }
  }

  return normalized;
}
