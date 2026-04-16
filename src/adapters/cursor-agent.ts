import path from "node:path";
import { readFile } from "node:fs/promises";
import type { CursorAgentConfig, RawRunArtifacts, RunHandle, RunInput, RunnerAdapter } from "../domain/adapter.js";
import type { SessionEvent, SessionReport } from "../domain/session-report.js";
import { resolveReportedPath } from "../normalize/reported-path.js";
import { inferSkillsFromPaths } from "../normalize/skill-detection.js";
import { writeText } from "../utils/fs.js";
import { BaseAdapter } from "./base.js";

export class CursorAgentAdapter extends BaseAdapter implements RunnerAdapter {
  constructor(private readonly options: CursorAgentConfig = { type: "cursor-agent", model: "composer-2-fast" }) {
    super();
  }

  async run(input: RunInput): Promise<RunHandle> {
    const command = this.options.command ?? "agent";
    const args = [
      ...(this.options.commandArgs ?? []),
      "-p",
      "--output-format",
      "stream-json",
      "--trust",
      "--force",
      "--workspace",
      input.cwd,
      ...(this.options.model ? ["--model", this.options.model] : []),
      input.prompt,
    ];

    return this.runCommand(command, args, input, {
      env: this.options.env,
    });
  }

  async collect(handle: RunHandle, input: RunInput): Promise<RawRunArtifacts> {
    const stdout = await readFile(handle.stdoutPath, "utf8");
    const stderr = await readFile(handle.stderrPath, "utf8");
    const exportPath = path.join(input.artifactsDir, "session.stream.jsonl");
    await writeText(exportPath, stdout);

    const records = parseJsonLines(stdout);

    return {
      stdout,
      stderr,
      stdoutPath: handle.stdoutPath,
      stderrPath: handle.stderrPath,
      startedAt: handle.startedAt,
      endedAt: handle.endedAt,
      durationMs: handle.durationMs,
      sessionId: extractSessionId(records),
      exportPath,
      rawSession: records,
    };
  }

  async normalize(input: RunInput, artifacts: RawRunArtifacts): Promise<SessionReport> {
    const records = Array.isArray(artifacts.rawSession) ? artifacts.rawSession : [];
    const events: SessionEvent[] = [];
    const observedReads: string[] = [];
    const explicitSkillNames = new Set<string>();
    const seenToolCalls = new Set<string>();

    let sessionCwd = input.cwd;
    let resultText: string | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let cacheTokens: number | undefined;

    for (const record of records) {
      if (!isRecord(record)) {
        continue;
      }

      const type = readString(record, "type");
      const at = readTimestamp(record);

      if (type === "system" && readString(record, "subtype") === "init") {
        sessionCwd = readString(record, "cwd") ?? sessionCwd;
      }

      if ((type === "user" || type === "assistant") && isRecord(record.message)) {
        const text = extractMessageText(record.message);
        if (text.length > 0) {
          events.push({
            type: "message",
            role: type,
            phase: type === "assistant" ? "final" : undefined,
            text,
            at,
          });
        }
      }

      if (type === "tool_call") {
        const toolCall = extractToolCall(record.tool_call);
        if (toolCall === undefined) {
          continue;
        }

        const callId = readString(record, "call_id");
        const isCompleted = readString(record, "subtype") === "completed";
        const hasEmittedCall = callId !== undefined && seenToolCalls.has(callId);

        if (!hasEmittedCall) {
          events.push({
            type: "toolCall",
            tool: toolCall.tool,
            args: toolCall.args,
            at,
          });

          if (callId !== undefined) {
            seenToolCalls.add(callId);
          }
        }

        const command = extractCommand(toolCall.tool, toolCall.args);
        if (command !== undefined) {
          events.push({ type: "command", command, at });
          for (const filePath of extractFilePathsFromCommand(command)) {
            const resolvedPath = resolveReportedPath(filePath, resolveToolBaseDir(toolCall.args, sessionCwd));
            if (resolvedPath === undefined) {
              continue;
            }

            observedReads.push(resolvedPath);
            events.push({ type: "fileRead", path: resolvedPath, at });
          }
        }

        const readPath = extractReadPath(toolCall.tool, toolCall.args);
        if (readPath !== undefined) {
          const resolvedPath = resolveReportedPath(readPath, resolveToolBaseDir(toolCall.args, sessionCwd));
          if (resolvedPath !== undefined) {
            observedReads.push(resolvedPath);
            events.push({ type: "fileRead", path: resolvedPath, at });
          }
        }

        const skillName = extractSkillName(toolCall.tool, toolCall.args);
        if (skillName !== undefined) {
          explicitSkillNames.add(skillName);
          events.push({ type: "skillSignal", skill: skillName, signal: "tool:skill", at });
        }

        if (isCompleted && toolCall.result !== undefined) {
          events.push({
            type: "toolResult",
            tool: toolCall.tool,
            output: stringifyUnknown(toolCall.result),
            at,
          });
        }
      }

      if (type === "result") {
        resultText = readString(record, "result") ?? resultText;
        const usage = isRecord(record.usage) ? record.usage : undefined;
        const providerInputTokens = usage === undefined ? undefined : readNumber(usage, "inputTokens");
        const providerOutputTokens = usage === undefined ? undefined : readNumber(usage, "outputTokens");
        const providerCacheReadTokens = usage === undefined ? undefined : readNumber(usage, "cacheReadTokens");

        inputTokens = providerInputTokens === undefined
          ? inputTokens
          : providerInputTokens + (providerCacheReadTokens ?? 0);
        outputTokens = providerOutputTokens ?? outputTokens;
        cacheTokens = providerCacheReadTokens ?? cacheTokens;
      }
    }

    const uniqueObservedReads = [...new Set(observedReads)];
    const detectedSkills = mergeDetectedSkills(
      inferSkillsFromPaths(uniqueObservedReads),
      [...explicitSkillNames].map((skill) => ({
        skill,
        confidence: "explicit" as const,
        evidence: ["Loaded via skill tool"],
      })),
    );
    const finalOutput = resultText ?? [...events]
      .reverse()
      .find((event): event is Extract<SessionEvent, { type: "message" }> => event.type === "message" && event.role === "assistant")?.text ?? artifacts.stdout;
    const totalTokens =
      inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens - (cacheTokens ?? 0)
        : undefined;

    return {
      runner: input.runner,
      sessionId: artifacts.sessionId,
      prompt: input.prompt,
      usage: {
        inputTokens,
        outputTokens,
        reasoningTokens: undefined,
        cacheTokens,
        totalTokens,
        inputChars: input.prompt.length,
        outputChars: finalOutput.length,
        reasoningChars: 0,
        source: {
          input: inputTokens === undefined ? "chars" : "provider",
          output: outputTokens === undefined ? "chars" : "provider",
          reasoning: "chars",
        },
      },
      files: {
        observedReads: uniqueObservedReads,
        observedSkillReads: uniqueObservedReads.filter((filePath) => filePath.endsWith("SKILL.md")),
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
}

function extractSessionId(records: unknown[]): string | undefined {
  for (const record of records) {
    if (!isRecord(record)) {
      continue;
    }

    const sessionId = readString(record, "session_id");
    if (sessionId !== undefined) {
      return sessionId;
    }
  }

  return undefined;
}

function parseJsonLines(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { type: "unparsed", raw: line };
      }
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function readTimestamp(record: Record<string, unknown>): string | undefined {
  const timestamp = record.timestamp_ms;
  return typeof timestamp === "number" ? new Date(timestamp).toISOString() : undefined;
}

function extractMessageText(message: Record<string, unknown>): string {
  const content = message.content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (!isRecord(item)) {
        return "";
      }

      return readString(item, "text") ?? "";
    })
    .filter((part) => part.length > 0)
    .join("\n");
}

function extractToolCall(value: unknown): { tool: string; args: unknown; result: unknown } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (!key.endsWith("ToolCall") || !isRecord(entry)) {
      continue;
    }

    return {
      tool: normalizeToolName(key.slice(0, -"ToolCall".length)),
      args: entry.args,
      result: entry.result,
    };
  }

  return undefined;
}

function normalizeToolName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

function extractCommand(tool: string, args: unknown): string | undefined {
  if (!tool.includes("shell") || !isRecord(args)) {
    return undefined;
  }

  return readString(args, "command");
}

function extractReadPath(tool: string, args: unknown): string | undefined {
  if (!tool.includes("read") || !isRecord(args)) {
    return undefined;
  }

  return readString(args, "filePath")
    ?? readString(args, "file_path")
    ?? readString(args, "path");
}

function extractSkillName(tool: string, args: unknown): string | undefined {
  if (!tool.includes("skill") || !isRecord(args)) {
    return undefined;
  }

  return readString(args, "name") ?? readString(args, "skill");
}

function resolveToolBaseDir(args: unknown, fallbackDir: string): string {
  if (!isRecord(args)) {
    return fallbackDir;
  }

  return readString(args, "workingDirectory")
    ?? readString(args, "cwd")
    ?? fallbackDir;
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

function extractFilePathsFromCommand(command: string): string[] {
  const reads: string[] = [];

  for (const segment of splitShellCommand(command)) {
    const trimmed = segment.trim();

    const sedMatch = trimmed.match(/^sed\s+-n\s+['"][^'"]+['"]\s+(.+)$/);
    if (sedMatch?.[1] !== undefined) {
      const filePath = normalizeCommandPathToken(sedMatch[1]);
      if (filePath !== undefined) {
        reads.push(filePath);
      }
      continue;
    }

    const catMatch = trimmed.match(/^cat\s+(.+)$/);
    if (catMatch?.[1] !== undefined) {
      const filePath = normalizeCommandPathToken(catMatch[1]);
      if (filePath !== undefined) {
        reads.push(filePath);
      }
    }
  }

  return [...new Set(reads)];
}

function splitShellCommand(command: string): string[] {
  return command
    .split(/&&|\|\||;/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function normalizeCommandPathToken(value: string): string | undefined {
  const token = value.trim().split(/\s+/)[0]?.trim();
  if (token === undefined || token.length === 0) {
    return undefined;
  }

  const unquoted = token.replace(/^['"]|['"]$/g, "");
  if (unquoted.length === 0 || unquoted.startsWith("-")) {
    return undefined;
  }

  return unquoted;
}

function mergeDetectedSkills(
  inferred: SessionReport["detectedSkills"],
  explicit: SessionReport["detectedSkills"],
): SessionReport["detectedSkills"] {
  const merged = new Map<string, SessionReport["detectedSkills"][number]>();

  for (const item of [...inferred, ...explicit]) {
    const existing = merged.get(item.skill);
    if (existing === undefined || compareConfidence(item.confidence, existing.confidence) < 0) {
      merged.set(item.skill, item);
      continue;
    }

    existing.evidence = [...new Set([...existing.evidence, ...item.evidence])];
  }

  return [...merged.values()];
}

function compareConfidence(a: SessionReport["detectedSkills"][number]["confidence"], b: SessionReport["detectedSkills"][number]["confidence"]): number {
  const order = ["explicit", "strong", "medium", "weak"];
  return order.indexOf(a) - order.indexOf(b);
}
