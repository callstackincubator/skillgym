import type { RunnerAdapter, RunnerAdapterConfig } from "../domain/adapter.ts";
import { CodexAdapter } from "./codex.ts";
import { OpenCodeAdapter } from "./opencode.ts";

export function getAdapter(config: RunnerAdapterConfig): RunnerAdapter {
  switch (config.type) {
    case "opencode":
      return new OpenCodeAdapter(config);
    case "codex":
      return new CodexAdapter(config);
  }
}
