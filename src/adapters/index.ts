import type { RunnerAdapter, RunnerAdapterConfig } from "../domain/adapter.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { CodexAdapter } from "./codex.js";
import { OpenCodeAdapter } from "./opencode.js";

export function getAdapter(config: RunnerAdapterConfig): RunnerAdapter {
  switch (config.type) {
    case "opencode":
      return new OpenCodeAdapter(config);
    case "codex":
      return new CodexAdapter(config);
    case "claude-code":
      return new ClaudeCodeAdapter(config);
  }
}
