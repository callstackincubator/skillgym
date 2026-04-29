import path from "node:path";
import { cp, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import type {
  CodexAgentConfig,
  RawRunArtifacts,
  RunHandle,
  RunInput,
  RunnerAdapter,
} from "../domain/adapter.js";
import type { SessionEvent, SessionReport } from "../domain/session-report.js";
import { resolveReportedPath } from "../normalize/reported-path.js";
import { inferSkillsFromPaths } from "../normalize/skill-detection.js";
import { ensureDir, writeText } from "../utils/fs.js";
import { BaseAdapter } from "./base.js";

export class CodexAdapter extends BaseAdapter implements RunnerAdapter {
  constructor(private readonly options: CodexAgentConfig = { type: "codex", model: "gpt-5" }) {
    super();
  }

  async run(input: RunInput): Promise<RunHandle> {
    const codexHome = getCodexHome(input);
    const codexSqliteHome = getCodexSqliteHome(input);
    const command = this.options.command ?? "npx";
    const args = [
      ...(this.options.commandArgs ?? []),
      "codex",
      "exec",
      ...(this.options.model === undefined ? [] : ["--model", this.options.model]),
      "--json",
      "--skip-git-repo-check",
      "-C",
      input.cwd,
      input.prompt,
    ];
    await Promise.all([ensureDir(codexHome), ensureDir(codexSqliteHome), seedCodexRuntime(input)]);
    const handle = await this.runCommand(command, args, input, {
      env: {
        ...this.options.env,
        CODEX_HOME: codexHome,
        CODEX_SQLITE_HOME: codexSqliteHome,
      },
    });
    return handle;
  }

  async collect(handle: RunHandle, input: RunInput): Promise<RawRunArtifacts> {
    const stdout = await readFile(handle.stdoutPath, "utf8");
    const stderr = await readFile(handle.stderrPath, "utf8");
    const stdoutRecords = parseJsonLines(stdout);
    const sessionPath = await this.findLatestSessionAfter(
      handle.startedAt,
      getCodexSessionsDir(input),
    );

    if (sessionPath === undefined && stdoutRecords.length === 0) {
      return {
        stdout,
        stderr,
        stdoutPath: handle.stdoutPath,
        stderrPath: handle.stderrPath,
        startedAt: handle.startedAt,
        endedAt: handle.endedAt,
        durationMs: handle.durationMs,
      };
    }

    const exportPath = path.join(input.artifactsDir, "session.jsonl");
    const sessionText = sessionPath === undefined ? stdout : await readFile(sessionPath, "utf8");
    await writeText(exportPath, sessionText);

    return {
      stdout,
      stderr,
      stdoutPath: handle.stdoutPath,
      stderrPath: handle.stderrPath,
      startedAt: handle.startedAt,
      endedAt: handle.endedAt,
      durationMs: handle.durationMs,
      sessionPath,
      exportPath,
      rawSession: sessionPath === undefined ? stdoutRecords : parseJsonLines(sessionText),
    };
  }

  async normalize(input: RunInput, artifacts: RawRunArtifacts): Promise<SessionReport> {
    const records = Array.isArray(artifacts.rawSession) ? artifacts.rawSession : [];
    const events: SessionEvent[] = [];
    const observedReads: string[] = [];
    const callBaseDirs = new Map<string, string>();
    let totalTokens: number | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let reasoningTokens: number | undefined;
    let cacheTokens: number | undefined;
    let sessionCwd: string | undefined;
    let turnCwd: string | undefined;

    for (const record of records) {
      if (!isRecord(record)) {
        continue;
      }

      const type = readString(record, "type");
      const payload = isRecord(record.payload) ? record.payload : undefined;
      const at = readString(record, "timestamp");

      if (type === "session_meta") {
        sessionCwd = readString(payload ?? {}, "cwd") ?? sessionCwd;
      }

      if (type === "turn_context") {
        turnCwd = readString(payload ?? {}, "cwd") ?? turnCwd;
      }

      if (type === "turn.completed" && isRecord(record.usage)) {
        inputTokens = readNumber(record.usage, "input_tokens") ?? inputTokens;
        outputTokens = readNumber(record.usage, "output_tokens") ?? outputTokens;
        cacheTokens = readNumber(record.usage, "cached_input_tokens") ?? cacheTokens;
      }

      if (type === "item.completed" && isRecord(record.item)) {
        const item = record.item;
        const itemType = readString(item, "type");
        if (itemType === "agent_message") {
          const text = readString(item, "text") ?? "";
          if (text.length > 0) {
            events.push({
              type: "message",
              role: "assistant",
              text,
              phase: "final",
              at,
            });
          }
        }
      }

      const payloadInfo = isRecord(payload?.info) ? payload.info : undefined;

      if (
        type === "event_msg" &&
        payload?.type === "token_count" &&
        isRecord(payloadInfo?.total_token_usage)
      ) {
        const usage = payloadInfo.total_token_usage as Record<string, unknown>;
        totalTokens = readNumber(usage, "total_tokens") ?? totalTokens;
        inputTokens = readNumber(usage, "input_tokens") ?? inputTokens;
        outputTokens = readNumber(usage, "output_tokens") ?? outputTokens;
        reasoningTokens = readNumber(usage, "reasoning_output_tokens") ?? reasoningTokens;
        cacheTokens = readNumber(usage, "cached_input_tokens") ?? cacheTokens;
      }

      if (type === "response_item" && payload?.type === "message") {
        const role = readString(payload, "role");
        const text = extractResponseItemText(payload);
        const phase = mapCodexPhase(readString(payload, "phase"), role);
        if ((role === "user" || role === "assistant") && text.length > 0) {
          events.push({
            type: "message",
            role,
            text,
            phase,
            at,
          });
        }
      }

      if (type === "response_item" && payload?.type === "reasoning") {
        const text = readString(payload, "text") ?? "";
        if (text.length > 0) {
          events.push({
            type: "message",
            role: "assistant",
            text,
            phase: "thinking",
            at,
          });
        }
      }

      if (type === "event_msg" && payload?.type === "agent_message") {
        const text = readString(payload, "message") ?? "";
        if (text.length > 0) {
          events.push({
            type: "message",
            role: "assistant",
            text,
            phase: mapCodexPhase(readString(payload, "phase"), "assistant"),
            at,
          });
        }
      }

      if (type === "response_item" && payload?.type === "function_call") {
        const tool = readString(payload, "name") ?? readString(payload, "tool");
        const args =
          parseMaybeJson(readString(payload, "arguments")) ?? payload.arguments ?? payload.args;
        const callId = readString(payload, "call_id") ?? readString(payload, "callId");

        if (callId !== undefined) {
          callBaseDirs.set(
            callId,
            resolveCodexCallBaseDir(args, turnCwd ?? sessionCwd ?? input.cwd),
          );
        }

        if (tool !== undefined) {
          events.push({
            type: "toolCall",
            tool,
            args,
            at,
          });
        }
      }

      if (type === "response_item" && payload?.type === "function_call_output") {
        const output = readString(payload, "output") ?? stringifyUnknown(payload.output ?? payload);
        const toolName = resolveCodexToolName(output);
        const callId = readString(payload, "call_id") ?? readString(payload, "callId");
        const baseDir =
          (callId === undefined ? undefined : callBaseDirs.get(callId)) ??
          turnCwd ??
          sessionCwd ??
          input.cwd;

        events.push({
          type: "toolResult",
          tool: toolName,
          output,
          at,
        });

        const command = extractCommandFromFunctionOutput(output);
        if (command !== undefined) {
          events.push({ type: "command", command, at });
        }

        const filePaths = extractFilePathsFromCommand(output);
        for (const filePath of filePaths) {
          const resolvedPath = resolveReportedPath(filePath, baseDir);
          if (resolvedPath === undefined) {
            continue;
          }

          observedReads.push(resolvedPath);
          events.push({ type: "fileRead", path: resolvedPath, at });
        }
      }
    }

    const detectedSkills = inferSkillsFromPaths(observedReads);
    const finalOutput =
      [...events]
        .reverse()
        .find(
          (event): event is Extract<SessionEvent, { type: "message" }> =>
            event.type === "message" && event.role === "assistant",
        )?.text ?? artifacts.stdout;
    const reasoningChars = events
      .filter(
        (event): event is Extract<SessionEvent, { type: "message" }> =>
          event.type === "message" && event.phase === "thinking",
      )
      .reduce((sum, event) => sum + event.text.length, 0);
    const normalizedTotalTokens =
      inputTokens !== undefined && outputTokens !== undefined && reasoningTokens !== undefined
        ? inputTokens + outputTokens + reasoningTokens - (cacheTokens ?? 0)
        : totalTokens;

    return {
      runner: input.runner,
      prompt: input.prompt,
      usage: {
        inputTokens,
        outputTokens,
        reasoningTokens,
        cacheTokens,
        totalTokens: normalizedTotalTokens,
        inputChars: input.prompt.length,
        outputChars: finalOutput.length,
        reasoningChars,
        source: {
          input: inputTokens === undefined ? "chars" : "provider",
          output: outputTokens === undefined ? "chars" : "provider",
          reasoning: reasoningTokens === undefined ? "chars" : "provider",
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
        sessionPath: artifacts.sessionPath,
        exportPath: artifacts.exportPath,
      },
    };
  }

  private async findLatestSessionAfter(
    startedAtIso: string,
    sessionsDir: string,
  ): Promise<string | undefined> {
    const startedAtMs = new Date(startedAtIso).getTime();
    const sessionPaths = await listJsonlFiles(sessionsDir);
    const candidates: Array<{ filePath: string; mtimeMs: number }> = [];

    for (const filePath of sessionPaths) {
      const fileStat = await stat(filePath);
      if (fileStat.mtimeMs >= startedAtMs - 1000) {
        candidates.push({ filePath, mtimeMs: fileStat.mtimeMs });
      }
    }

    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    return candidates[0]?.filePath;
  }
}

function getCodexHome(input: RunInput): string {
  return path.join(input.artifactsDir, "codex-home");
}

function getCodexSqliteHome(input: RunInput): string {
  return path.join(getCodexHome(input), "sqlite");
}

function getCodexSessionsDir(input: RunInput): string {
  return path.join(getCodexHome(input), "sessions");
}

async function seedCodexRuntime(input: RunInput): Promise<void> {
  const sourceHome = getUserCodexHome();
  const targetHome = getCodexHome(input);

  for (const entry of [
    "auth.json",
    "config.toml",
    "version.json",
    "AGENTS.md",
    ".codex-global-state.json",
  ]) {
    await copyCodexEntry(path.join(sourceHome, entry), path.join(targetHome, entry));
  }
}

function getUserCodexHome(): string {
  return path.join(os.homedir(), ".codex");
}

async function copyCodexEntry(sourcePath: string, targetPath: string): Promise<void> {
  try {
    const sourceStat = await stat(sourcePath);

    if (sourceStat.isDirectory()) {
      await cp(sourcePath, targetPath, {
        recursive: true,
        force: true,
        verbatimSymlinks: true,
      });
      return;
    }

    if (sourceStat.isFile()) {
      await cp(sourcePath, targetPath, { force: true });
    }
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return;
    }

    throw error;
  }
}

async function listJsonlFiles(rootDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }
  const results: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listJsonlFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(entryPath);
    }
  }

  return results;
}

function isMissingDirectoryError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
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

function extractResponseItemText(record: Record<string, unknown>): string {
  const text = record.text;
  if (typeof text === "string") {
    return text;
  }

  const content = record.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!isRecord(part)) {
          return "";
        }

        const value = readString(part, "text");
        return value ?? "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function mapCodexPhase(
  phase: string | undefined,
  role: string | undefined,
): "thinking" | "commentary" | "final" | undefined {
  if (phase === "commentary") {
    return "commentary";
  }

  if (phase === "final_answer") {
    return "final";
  }

  return role === "assistant" ? "final" : undefined;
}

function parseMaybeJson(value: string | undefined): unknown {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function resolveCodexCallBaseDir(args: unknown, fallbackDir: string): string {
  if (!isRecord(args)) {
    return fallbackDir;
  }

  return readString(args, "workdir") ?? readString(args, "cwd") ?? fallbackDir;
}

function resolveCodexToolName(output: string): string | undefined {
  if (output.includes("Command:")) {
    return "exec_command";
  }

  return undefined;
}

function extractCommandFromFunctionOutput(output: string): string | undefined {
  const match = output.match(/^Command:\s+.*?\s-lc\s+(.+)$/m);
  return match?.[1]?.replace(/^['"]|['"]$/g, "");
}

function extractFilePathsFromCommand(output: string): string[] {
  const command = extractCommandFromFunctionOutput(output);
  if (command === undefined) {
    return [];
  }

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
      continue;
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
