import type { AgentType } from "../domain/runner.js";

export interface MaxStepsMonitorOptions {
  agentType: AgentType;
  runnerId: string;
  maxSteps: number;
}

export interface MaxStepsState {
  observedSteps: number;
  maxSteps: number;
  runnerId: string;
  agentType: AgentType;
}

export class MaxStepsExceededError extends Error {
  readonly observedSteps: number;
  readonly maxSteps: number;
  readonly runnerId: string;
  readonly agentType: AgentType;

  constructor(state: MaxStepsState) {
    super(
      `Exceeded maxSteps: observed ${String(state.observedSteps)} steps with limit ${String(state.maxSteps)} for runner "${state.runnerId}" (${state.agentType}). Agent terminated by skillgym. Raw output preserved.`,
    );
    this.name = "MaxStepsExceededError";
    this.observedSteps = state.observedSteps;
    this.maxSteps = state.maxSteps;
    this.runnerId = state.runnerId;
    this.agentType = state.agentType;
  }
}

export function isMaxStepsExceededError(error: unknown): error is MaxStepsExceededError {
  return error instanceof MaxStepsExceededError;
}

export function createMaxStepsMonitor(options: MaxStepsMonitorOptions): {
  observeLine(line: string): MaxStepsState | undefined;
} {
  const detector = createStepDetector(options.agentType);

  return {
    observeLine(line: string): MaxStepsState | undefined {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        return undefined;
      }

      let record: unknown;

      try {
        record = JSON.parse(trimmed);
      } catch {
        return undefined;
      }

      const observedSteps = detector.observe(record);
      if (observedSteps <= options.maxSteps) {
        return undefined;
      }

      return {
        observedSteps,
        maxSteps: options.maxSteps,
        runnerId: options.runnerId,
        agentType: options.agentType,
      };
    },
  };
}

interface StepDetector {
  observe(record: unknown): number;
}

function createStepDetector(agentType: AgentType): StepDetector {
  switch (agentType) {
    case "codex":
      return new CodexStepDetector();
    case "opencode":
      return new OpenCodeStepDetector();
    case "claude-code":
      return new ClaudeCodeStepDetector();
    case "cursor-agent":
      return new CursorAgentStepDetector();
  }
}

class CodexStepDetector implements StepDetector {
  private steps = 0;

  observe(record: unknown): number {
    if (readString(record, "type") === "turn.completed") {
      this.steps += 1;
    }

    return this.steps;
  }
}

class OpenCodeStepDetector implements StepDetector {
  private steps = 0;

  observe(record: unknown): number {
    if (readString(record, "type") === "step_finish") {
      this.steps += 1;
    }

    return this.steps;
  }
}

class ClaudeCodeStepDetector implements StepDetector {
  private steps = 0;
  private readonly seenMessageIds = new Set<string>();

  observe(record: unknown): number {
    if (readString(record, "type") !== "assistant") {
      return this.steps;
    }

    const message = readRecord(record, "message");
    const messageId = readString(message, "id");
    if (messageId === undefined || this.seenMessageIds.has(messageId)) {
      return this.steps;
    }

    this.seenMessageIds.add(messageId);
    this.steps += 1;
    return this.steps;
  }
}

class CursorAgentStepDetector implements StepDetector {
  private steps = 0;

  observe(record: unknown): number {
    if (readString(record, "type") === "assistant") {
      this.steps += 1;
    }

    return this.steps;
  }
}

function readRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const nested = value[key];
  return typeof nested === "string" ? nested : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
