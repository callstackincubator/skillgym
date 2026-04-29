import type { SessionEvent, SessionReport, SkillDetection } from "./session-report.js";

export interface WorkspaceBootstrapConfig {
  command: string;
  args?: string[];
  timeoutMs?: number;
  env?: Record<string, string>;
}

export type SuiteWorkspaceConfig =
  | {
      mode: "shared";
      cwd?: string;
      templateDir?: never;
      bootstrap?: never;
    }
  | {
      mode: "isolated";
      cwd?: never;
      templateDir?: string;
      bootstrap?: WorkspaceBootstrapConfig;
    };

export interface TestCase {
  id: string;
  prompt: string;
  tags?: string[];
  timeoutMs?: number;
  assert(report: SessionReport, ctx: AssertionContext): void | Promise<void>;
}

export interface AssertionContext {
  getCommands(): string[];
  getToolCalls(tool?: string): SessionEvent[];
  getFileReads(): string[];
  detectedSkills(): SkillDetection[];
  finalOutput(): string;
}

export type TestSuite = TestCase[] | Record<string, TestCase>;
