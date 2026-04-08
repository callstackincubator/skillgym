import { createHash } from "node:crypto";
import type { AgentConfig, RunnerInfo } from "../domain/runner.ts";

export function createRunnerInfo(id: string, agent: Pick<AgentConfig, "type" | "model">): RunnerInfo {
  return {
    id,
    pathKey: `${slug(id, "runner")}--${shortHash(id)}`,
    agent: {
      type: agent.type,
      model: agent.model,
    },
  };
}

function slug(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : fallback;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}
