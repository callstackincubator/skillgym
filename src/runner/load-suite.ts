import path from "node:path";
import type { SuiteWorkspaceConfig, TestCase, TestSuite } from "../domain/test-case.ts";
import { importFromPath } from "../utils/import.ts";
import { validateSuiteWorkspaceConfig } from "./workspace.ts";

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
      cases: suite,
      workspace: imported.workspace,
    };
  }

  if (imported.workspace !== undefined) {
    validateSuiteWorkspaceConfig(imported.workspace);
  }

  return {
    filePath: absolutePath,
    dirPath: path.dirname(absolutePath),
    cases: Object.values(suite),
    workspace: imported.workspace,
  };
}
