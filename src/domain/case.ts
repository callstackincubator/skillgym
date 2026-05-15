import type { FailureClass, RunnerResult } from "./result.js";
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
      templateDir?: string;
      bootstrap?: WorkspaceBootstrapConfig;
    }
  | {
      mode: "isolated";
      cwd?: never;
      templateDir?: string;
      bootstrap?: WorkspaceBootstrapConfig;
    };

export interface Case {
  id: string;
  prompt: string;
  tags?: string[];
  timeoutMs?: number;
  expectedFail?: boolean;
  classifyFailure?(result: RunnerResult): FailureClass | string | undefined;
  assert(report: SessionReport, ctx: AssertionContext): void | Promise<void>;
}

export interface AssertionContext {
  getCommands(): string[];
  getToolCalls(tool?: string): SessionEvent[];
  getFileReads(): string[];
  detectedSkills(): SkillDetection[];
  finalOutput(): string;
}

export type Suite = Case[] | Record<string, Case>;
