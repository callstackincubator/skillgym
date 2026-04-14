import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ClaudeCodeAgentConfig, RawRunArtifacts, RunHandle, RunInput, RunnerAdapter } from "../domain/adapter.js";
import type { SessionEvent, SessionReport } from "../domain/session-report.js";
import { resolveReportedPath } from "../normalize/reported-path.js";
import { inferSkillsFromPaths } from "../normalize/skill-detection.js";
import { writeText } from "../utils/fs.js";
import { BaseAdapter } from "./base.js";

interface ClaudeCodeResultRecord {
  type: "result";
  result: string;
  is_error: boolean;
  session_id?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export class ClaudeCodeAdapter extends BaseAdapter implements RunnerAdapter {
  constructor(private readonly options: ClaudeCodeAgentConfig = { type: "claude-code", model: "claude-sonnet-4-6" }) {
    super();
  }

  async run(input: RunInput): Promise<RunHandle> {
    const command = this.options.command ?? "claude";
    const args = [
      ...(this.options.commandArgs ?? []),
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--no-session-persistence",
      ...(this.options.model ? ["--model", this.options.model] : []),
      input.prompt,
    ];
    const handle = await this.runCommand(command, args, input, {
      env: this.options.env,
    });
    return handle;
  }

  async collect(handle: RunHandle, input: RunInput): Promise<RawRunArtifacts> {
    const stdout = await readFile(handle.stdoutPath, "utf8");
    const stderr = await readFile(handle.stderrPath, "utf8");

    const exportPath = path.join(input.artifactsDir, "session.stream.jsonl");
    await writeText(exportPath, stdout);

    const records = parseJsonLines(stdout);
    const sessionId = extractSessionId(records);

    return {
      stdout,
      stderr,
      stdoutPath: handle.stdoutPath,
      stderrPath: handle.stderrPath,
      startedAt: handle.startedAt,
      endedAt: handle.endedAt,
      durationMs: handle.durationMs,
      sessionId,
      exportPath,
      rawSession: records,
    };
  }

  async normalize(input: RunInput, artifacts: RawRunArtifacts): Promise<SessionReport> {
    const records = Array.isArray(artifacts.rawSession) ? artifacts.rawSession : [];
    const events: SessionEvent[] = [];
    const observedReads: string[] = [];
    const explicitSkillNames = new Set<string>();
    const toolCallNames = new Map<string, string>();

    let resultRecord: ClaudeCodeResultRecord | undefined;
    let reasoningChars = 0;

    for (const record of records) {
      if (!isRecord(record)) {
        continue;
      }

      const type = readString(record, "type");

      if (type === "assistant" && isRecord(record.message)) {
        const message = record.message;
        const content = Array.isArray(message.content) ? message.content : [];

        for (const block of content) {
          if (!isRecord(block)) {
            continue;
          }

          const blockType = readString(block, "type");

          if (blockType === "thinking") {
            const text = readString(block, "thinking") ?? "";
            if (text.length > 0) {
              reasoningChars += text.length;
              events.push({ type: "message", role: "assistant", phase: "thinking", text });
            }
          }

          if (blockType === "text") {
            const text = readString(block, "text") ?? "";
            if (text.length > 0) {
              events.push({ type: "message", role: "assistant", phase: "final", text });
            }
          }

          if (blockType === "tool_use") {
            const toolName = readString(block, "name") ?? "";
            const toolId = readString(block, "id") ?? "";
            const toolInput = isRecord(block.input) ? block.input : {};

            if (toolName === "Skill") {
              const skillName = readString(toolInput, "skill") ?? readString(toolInput, "name");
              if (skillName !== undefined) {
                explicitSkillNames.add(skillName);
                events.push({ type: "skillSignal", skill: skillName, signal: "tool:skill" });
              }
            }

            if (toolId.length > 0) {
              toolCallNames.set(toolId, toolName);
            }

            if (toolName.length > 0) {
              events.push({ type: "toolCall", tool: toolName, args: toolInput });
            }

            if (toolName === "Read" || toolName === "read") {
              const filePath = resolveReportedPath(
                readString(toolInput, "file_path"),
                input.cwd,
              );
              if (filePath !== undefined) {
                observedReads.push(filePath);
                events.push({ type: "fileRead", path: filePath });
              }
            }

            if (toolName === "Bash") {
              const command = readString(toolInput, "command");
              if (command !== undefined) {
                events.push({ type: "command", command });
              }
            }
          }
        }
      }

      if (type === "user" && isRecord(record.message)) {
        const message = record.message;
        const content = Array.isArray(message.content) ? message.content : [];

        for (const block of content) {
          if (!isRecord(block) || readString(block, "type") !== "tool_result") {
            continue;
          }

          const toolUseId = readString(block, "tool_use_id") ?? "";
          const output = stringifyToolResultContent(block.content);

          if (output.length > 0) {
            events.push({ type: "toolResult", tool: toolCallNames.get(toolUseId), output });
          }
        }
      }

      if (type === "result") {
        resultRecord = record as unknown as ClaudeCodeResultRecord;
      }
    }

    const usage = resultRecord?.usage;
    const inputRaw = usage?.input_tokens;
    const cacheRead = usage?.cache_read_input_tokens;
    const outputTokens = usage?.output_tokens;

    const inputTokens =
      inputRaw !== undefined
        ? inputRaw + (cacheRead ?? 0)
        : cacheRead !== undefined
          ? cacheRead
          : undefined;
    const cacheTokens = cacheRead;
    const totalTokens =
      inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens - (cacheTokens ?? 0)
        : undefined;

    const detectedSkills = mergeDetectedSkills(
      inferSkillsFromPaths(observedReads),
      [...explicitSkillNames].map((skill) => ({
        skill,
        confidence: "explicit" as const,
        evidence: ["Loaded via Skill tool"],
      })),
    );

    const finalOutput =
      resultRecord?.result ??
      [...events]
        .reverse()
        .find(
          (e): e is Extract<SessionEvent, { type: "message" }> =>
            e.type === "message" && e.role === "assistant",
        )?.text ??
      artifacts.stdout;

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
        reasoningChars,
        source: {
          input: inputTokens === undefined ? "chars" : "provider",
          output: outputTokens === undefined ? "chars" : "provider",
          reasoning: "chars",
        },
      },
      files: {
        observedReads,
        observedSkillReads: observedReads.filter((p) => p.endsWith("SKILL.md")),
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

    if (readString(record, "type") === "system") {
      const sessionId = readString(record, "session_id");
      if (sessionId !== undefined) {
        return sessionId;
      }
    }

    if (readString(record, "type") === "result") {
      const sessionId = readString(record, "session_id");
      if (sessionId !== undefined) {
        return sessionId;
      }
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

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!isRecord(item)) {
          return "";
        }
        const text = item.text;
        return typeof text === "string" ? text : JSON.stringify(item);
      })
      .filter(Boolean)
      .join("\n");
  }

  if (content === undefined || content === null) {
    return "";
  }

  return JSON.stringify(content);
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

function compareConfidence(
  left: "explicit" | "strong" | "medium" | "weak",
  right: "explicit" | "strong" | "medium" | "weak",
): number {
  const order = ["explicit", "strong", "medium", "weak"] as const;
  return order.indexOf(left) - order.indexOf(right);
}
