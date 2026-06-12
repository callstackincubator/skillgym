export type RunnerId = string;

export type AgentType = "codex" | "opencode" | "claude-code" | "cursor-agent" | "copilot";

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
    } & CommonAgentConfig)
  | ({
      type: "claude-code";
    } & CommonAgentConfig)
  | ({
      type: "cursor-agent";
    } & CommonAgentConfig)
  | ({
      type: "copilot";
    } & CommonAgentConfig);

export type CodexAgentConfig = Extract<AgentConfig, { type: "codex" }>;

export type OpenCodeAgentConfig = Extract<AgentConfig, { type: "opencode" }>;

export type ClaudeCodeAgentConfig = Extract<AgentConfig, { type: "claude-code" }>;

export type CursorAgentConfig = Extract<AgentConfig, { type: "cursor-agent" }>;

export type CopilotAgentConfig = Extract<AgentConfig, { type: "copilot" }>;

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
