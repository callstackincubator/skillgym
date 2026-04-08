import path from "node:path";
import { copyFile, readFile } from "node:fs/promises";
import type { OpenCodeAgentConfig, RawRunArtifacts, RunHandle, RunInput, RunnerAdapter } from "../domain/adapter.ts";
import type { SessionEvent, SessionReport } from "../domain/session-report.ts";
import { inferSkillsFromPaths } from "../normalize/skill-detection.ts";
import { ensureDir, writeJson, writeText } from "../utils/fs.ts";
import { BaseAdapter } from "./base.ts";

const OPEN_CODE_EXPORT_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000] as const;

interface OpenCodeExport {
  info?: {
    id?: string;
    time?: {
      created?: number;
      updated?: number;
    };
  };
  messages?: OpenCodeMessage[];
  [key: string]: unknown;
}

interface OpenCodeMessage {
  info?: {
    role?: string;
    tokens?: {
      total?: number;
      input?: number;
      output?: number;
      reasoning?: number;
    };
    time?: {
      created?: number;
      completed?: number;
    };
  };
  parts?: OpenCodePart[];
}

interface OpenCodePart {
  type?: string;
  text?: string;
  tool?: string;
  state?: {
    input?: Record<string, unknown>;
    output?: unknown;
    time?: {
      start?: number;
      end?: number;
    };
  };
  tokens?: {
    total?: number;
    input?: number;
    output?: number;
    reasoning?: number;
  };
}

export class OpenCodeAdapter extends BaseAdapter implements RunnerAdapter {
  constructor(private readonly options: OpenCodeAgentConfig = { type: "opencode", model: "openai/gpt-5" }) {
    super();
  }

  async run(input: RunInput): Promise<RunHandle> {
    await prepareOpenCodeRuntime(input);
    const command = this.options.command ?? "opencode";
    const args = [
      ...(this.options.commandArgs ?? []),
      "run",
      ...(this.options.model === undefined ? [] : ["--model", this.options.model]),
      "--format",
      "json",
      "--thinking",
      input.prompt,
    ];
    const handle = await this.runCommand(
      command,
      args,
      input,
      { env: getOpenCodeEnv(input, this.options.env) },
    );
    return handle;
  }

  async collect(handle: RunHandle, input: RunInput): Promise<RawRunArtifacts> {
    const stdout = await readFile(handle.stdoutPath, "utf8");
    const stderr = await readFile(handle.stderrPath, "utf8");
    const runError = extractOpenCodeRunError(stdout) ?? extractOpenCodeRunError(stderr);

    if (runError !== undefined) {
      throw new Error(`OpenCode run failed: ${runError}`);
    }

    const sessionId = this.extractSessionId(stdout) ?? this.extractSessionId(stderr);

    if (sessionId === undefined) {
      throw new Error("OpenCode run did not emit a session id; cannot export structured session data.");
    }

    const exportCommand = this.options.command ?? "opencode";
    const exportArgs = [...(this.options.commandArgs ?? []), "export", sessionId];
    const exportResult = await this.collectExportWithRetry(exportCommand, exportArgs, input);

    const exportPath = path.join(input.artifactsDir, "session.export.json");
    await writeJson(exportPath, exportResult.parsed);
    await writeText(path.join(input.artifactsDir, "raw-run.jsonl"), stdout);

    return {
      stdout,
      stderr,
      stdoutPath: handle.stdoutPath,
      stderrPath: handle.stderrPath,
      startedAt: handle.startedAt,
      endedAt: handle.endedAt,
      durationMs: handle.durationMs,
      sessionId: exportResult.parsed.info?.id ?? sessionId,
      exportPath,
      rawSession: exportResult.parsed,
    };
  }

  private async collectExportWithRetry(
    command: string,
    args: string[],
    input: RunInput,
  ): Promise<{ parsed: OpenCodeExport & { messages: OpenCodeMessage[] } }> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= OPEN_CODE_EXPORT_RETRY_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) {
        const delayMs = OPEN_CODE_EXPORT_RETRY_DELAYS_MS[attempt - 1];
        if (delayMs !== undefined) {
          await sleep(delayMs);
        }
      }

      const exportHandle = await this.runCommand(
        command,
        args,
        {
          ...input,
          artifactsDir: path.join(input.artifactsDir, "export-command"),
        },
        { env: getOpenCodeEnv(input, this.options.env) },
      );
      const exportStdout = await readFile(exportHandle.stdoutPath, "utf8");

      try {
        return { parsed: parseOpenCodeExport(exportStdout) };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError ?? new Error("OpenCode export failed with an unknown error.");
  }

  async normalize(input: RunInput, artifacts: RawRunArtifacts): Promise<SessionReport> {
    const events: SessionEvent[] = [];
    const observedReads: string[] = [];
    const raw = artifacts.rawSession;
    if (!isOpenCodeExport(raw)) {
      throw new Error("OpenCode artifacts did not include a structured export session.");
    }

    const explicitSkillNames = new Set<string>();
    const tokenUsage = sumOpenCodeTokenUsage(raw.messages);
    let reasoningChars = 0;

    const messages = raw.messages;
    for (const message of messages) {
      const role = message.info?.role;
      const at = unixMsToIso(message.info?.time?.created);

      for (const part of message.parts ?? []) {
        const partAt = at ?? unixMsToIso(part.state?.time?.start);

        if (part.type === "reasoning" && typeof part.text === "string") {
          reasoningChars += part.text.length;
          events.push({
            type: "message",
            role: "assistant",
            phase: "thinking",
            text: part.text,
            at: partAt,
          });
          continue;
        }

        if (part.type === "text" && typeof part.text === "string" && (role === "user" || role === "assistant")) {
          const assistantPhase = role === "assistant" ? inferAssistantPhase(part.text) : undefined;
          events.push({
            type: "message",
            role,
            text: part.text,
            phase: assistantPhase,
            at: partAt,
          });
          continue;
        }

        if (part.type === "tool" && typeof part.tool === "string") {
          if (part.tool === "skill") {
            const skillName = readStringFromUnknown(part.state?.input, "name");
            if (skillName !== undefined) {
              explicitSkillNames.add(skillName);
              events.push({
                type: "skillSignal",
                skill: skillName,
                signal: "tool:skill",
                at: partAt,
              });
            }
          }

          events.push({
            type: "toolCall",
            tool: part.tool,
            args: part.state?.input,
            at: partAt,
          });

          const output = stringifyUnknown(part.state?.output);
          if (output.length > 0) {
            events.push({
              type: "toolResult",
              tool: part.tool,
              output,
              at: unixMsToIso(part.state?.time?.end) ?? partAt,
            });
          }

          const command = readStringFromUnknown(part.state?.input, "command");
          if (command !== undefined) {
            events.push({ type: "command", command, at: partAt });
          }

          const filePath = extractReadPath(part.tool, part.state?.input);
          if (filePath !== undefined) {
            observedReads.push(filePath);
            events.push({ type: "fileRead", path: filePath, at: partAt });
          }
        }
      }
    }

    const detectedSkills = mergeDetectedSkills(
      inferSkillsFromPaths(observedReads),
      [...explicitSkillNames].map((skill) => ({
        skill,
        confidence: "explicit" as const,
        evidence: ["Loaded via skill tool"],
      })),
    );
    const finalOutput = [...events]
      .reverse()
      .find((event): event is Extract<SessionEvent, { type: "message" }> => event.type === "message" && event.role === "assistant")?.text ?? "";
    const completionTokens =
      tokenUsage.outputTokens !== undefined && tokenUsage.reasoningTokens !== undefined
        ? tokenUsage.outputTokens + tokenUsage.reasoningTokens
        : undefined;

    return {
      runner: input.runner,
      sessionId: artifacts.sessionId,
      prompt: input.prompt,
      usage: {
        totalTokens: tokenUsage.totalTokens,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        reasoningTokens: tokenUsage.reasoningTokens,
        completionTokens,
        inputChars: input.prompt.length,
        outputChars: finalOutput.length,
        reasoningChars,
        source: {
          input: tokenUsage.inputTokens === undefined ? "chars" : "provider",
          output: tokenUsage.outputTokens === undefined ? "chars" : "provider",
          reasoning: tokenUsage.reasoningTokens === undefined ? "chars" : "provider",
        },
      },
      files: {
        observedReads,
        observedSkillReads: observedReads.filter((filePath) => filePath.endsWith("SKILL.md")),
      },
      detectedSkills,
      events,
      finalOutput,
      startedAt: artifacts.startedAt,
      endedAt: artifacts.endedAt,
      durationMs: artifacts.durationMs,
      rawArtifacts: {
        stdoutPath: artifacts.stdoutPath,
        stderrPath: artifacts.stderrPath,
        exportPath: artifacts.exportPath,
      },
    };
  }

  private extractSessionId(text: string): string | undefined {
    const match = text.match(/\b(ses_[A-Za-z0-9]+)\b/);
    return match?.[1];
  }
}

function getOpenCodeRuntimeRoot(input: RunInput): string {
  return path.join(input.artifactsDir, "opencode-xdg");
}

function extractOpenCodeRunError(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        error?: {
          message?: string;
        };
      };

      if (parsed.type === "error" && typeof parsed.error?.message === "string" && parsed.error.message.length > 0) {
        return parsed.error.message;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function getOpenCodePaths(input: RunInput): {
  dataHome: string;
  configHome: string;
  stateHome: string;
  cacheHome: string;
} {
  const root = getOpenCodeRuntimeRoot(input);
  return {
    dataHome: path.join(root, "data"),
    configHome: path.join(root, "config"),
    stateHome: path.join(root, "state"),
    cacheHome: path.join(root, "cache"),
  };
}

function getOpenCodeEnv(input: RunInput, baseEnv?: Record<string, string>): Record<string, string> {
  const paths = getOpenCodePaths(input);
  return {
    ...baseEnv,
    XDG_DATA_HOME: paths.dataHome,
    XDG_CONFIG_HOME: paths.configHome,
    XDG_STATE_HOME: paths.stateHome,
    XDG_CACHE_HOME: paths.cacheHome,
  };
}

async function prepareOpenCodeRuntime(input: RunInput): Promise<void> {
  const paths = getOpenCodePaths(input);
  await Promise.all([
    ensureDir(paths.dataHome),
    ensureDir(paths.configHome),
    ensureDir(paths.stateHome),
    ensureDir(paths.cacheHome),
    seedOpenCodeAuth(paths.dataHome),
  ]);
}

async function seedOpenCodeAuth(dataHome: string): Promise<void> {
  const sourceAuthPath = defaultOpenCodeAuthPath();
  if (sourceAuthPath === undefined) {
    return;
  }

  try {
    await readFile(sourceAuthPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }

  const targetAuthPath = path.join(dataHome, "opencode", "auth.json");
  await ensureDir(path.dirname(targetAuthPath));
  await copyFile(sourceAuthPath, targetAuthPath);
}

function defaultOpenCodeAuthPath(): string | undefined {
  const homeDir = process.env.HOME;
  if (homeDir === undefined || homeDir.length === 0) {
    return undefined;
  }

  return path.join(homeDir, ".local", "share", "opencode", "auth.json");
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function parseOpenCodeExport(value: string): OpenCodeExport & { messages: OpenCodeMessage[] } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenCode export returned invalid JSON: ${reason}`);
  }

  if (!isOpenCodeExport(parsed)) {
    throw new Error("OpenCode export was missing required session fields.");
  }

  return parsed;
}

function isOpenCodeExport(value: unknown): value is OpenCodeExport & { messages: OpenCodeMessage[] } {
  return isRecord(value) && isRecord(value.info) && Array.isArray(value.messages);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readStringFromUnknown(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return readString(value, key);
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "";
  }

  return JSON.stringify(value);
}

function inferAssistantPhase(text: string): "commentary" | "final" {
  return text.includes("I’m") || text.includes("I'm") ? "commentary" : "final";
}

function sumOpenCodeTokenUsage(messages: OpenCodeMessage[]): {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
} {
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
  let totalTokens: number | undefined;
  const seen = {
    inputTokens: false,
    outputTokens: false,
    reasoningTokens: false,
  };

  for (const message of messages) {
    const tokens = message.info?.tokens;
    if (tokens === undefined) {
      continue;
    }

    if (typeof tokens.input === "number" && Number.isFinite(tokens.input)) {
      totals.inputTokens += tokens.input;
      seen.inputTokens = true;
    }

    if (typeof tokens.total === "number" && Number.isFinite(tokens.total)) {
      totalTokens = Math.max(totalTokens ?? 0, tokens.total);
    }

    if (typeof tokens.output === "number" && Number.isFinite(tokens.output)) {
      totals.outputTokens += tokens.output;
      seen.outputTokens = true;
    }

    if (typeof tokens.reasoning === "number" && Number.isFinite(tokens.reasoning)) {
      totals.reasoningTokens += tokens.reasoning;
      seen.reasoningTokens = true;
    }
  }

  return {
    totalTokens,
    inputTokens: seen.inputTokens ? totals.inputTokens : undefined,
    outputTokens: seen.outputTokens ? totals.outputTokens : undefined,
    reasoningTokens: seen.reasoningTokens ? totals.reasoningTokens : undefined,
  };
}

function extractReadPath(tool: string, input: unknown): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  if (tool === "read") {
    return readString(input, "filePath");
  }

  return undefined;
}

function unixMsToIso(value: number | undefined): string | undefined {
  return typeof value === "number" ? new Date(value).toISOString() : undefined;
}

function mergeDetectedSkills(
  inferred: SessionReport["detectedSkills"],
  explicit: SessionReport["detectedSkills"],
): SessionReport["detectedSkills"] {
  const merged = new Map<string, SessionReport["detectedSkills"][number]>();

  for (const detection of [...inferred, ...explicit]) {
    const existing = merged.get(detection.skill);

    if (existing === undefined) {
      merged.set(detection.skill, {
        ...detection,
        evidence: [...detection.evidence],
      });
      continue;
    }

    existing.evidence.push(...detection.evidence);
    if (compareConfidence(detection.confidence, existing.confidence) < 0) {
      existing.confidence = detection.confidence;
    }
  }

  return [...merged.values()];
}

function compareConfidence(left: "explicit" | "strong" | "medium" | "weak", right: "explicit" | "strong" | "medium" | "weak"): number {
  const order = ["explicit", "strong", "medium", "weak"] as const;
  return order.indexOf(left) - order.indexOf(right);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
