export type RunnerId = string;

export type AgentType = "codex" | "opencode";

export interface CommonAgentConfig {
  command?: string;
  commandArgs?: string[];
  env?: Record<string, string>;
  model: string;
}

export type AgentConfig =
  | ({
      type: "codex";
    } & CommonAgentConfig)
  | ({
      type: "opencode";
    } & CommonAgentConfig);

export type CodexAgentConfig = Extract<AgentConfig, { type: "codex" }>;

export type OpenCodeAgentConfig = Extract<AgentConfig, { type: "opencode" }>;

export interface RunnerConfig {
  agent: AgentConfig;
}

export interface RunnerInfo {
  id: RunnerId;
  pathKey: string;
  agent: {
    type: AgentType;
    model: string;
  };
}

export interface ResolvedRunner {
  id: RunnerId;
  info: RunnerInfo;
  config: RunnerConfig;
}
