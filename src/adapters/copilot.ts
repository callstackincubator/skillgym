import path from "node:path";
import { readFile } from "node:fs/promises";
import type {
  CopilotAgentConfig,
  ExplainInput,
  ExplainResult,
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

interface CopilotRawSession {
  records: unknown[];
  telemetryRecords: unknown[];
}

export class CopilotAdapter extends BaseAdapter implements RunnerAdapter {
  constructor(
    private readonly options: CopilotAgentConfig = { type: "copilot", model: "gpt-5.4-mini" },
  ) {
    super();
  }

  async run(input: RunInput): Promise<RunHandle> {
    await prepareCopilotRuntime(input);
    const command = this.options.command ?? "copilot";
    const args = this.createPromptArgs(input.prompt, input.cwd);

    return this.runCommand(command, args, input, {
      env: getCopilotEnv(input, this.options.env),
    });
  }

  async explain(input: ExplainInput): Promise<ExplainResult> {
    const answers = [];
    const baseInput = createExplainRunInput(input);
    await prepareCopilotRuntime(baseInput);

    for (const [index, question] of input.questions.entries()) {
      const questionInput = createExplainQuestionInput(
        baseInput,
        input.artifactDir,
        index,
        question.question,
      );
      const command = this.options.command ?? "copilot";
      const args = [
        ...(this.options.commandArgs ?? []),
        "-p",
        question.question,
        `--resume=${input.sessionId}`,
        ...(this.options.model === undefined ? [] : ["--model", this.options.model]),
        "--output-format",
        "json",
        "--stream",
        "on",
        "--no-auto-update",
        "--no-custom-instructions",
        "--disable-builtin-mcps",
        "--no-remote",
        "--allow-all-tools",
        "--disallow-temp-dir",
        "-C",
        input.cwd,
      ];
      const handle = await this.runCommand(command, args, questionInput, {
        env: getCopilotEnv(
          {
            ...questionInput,
            artifactsDir: input.artifactDir,
          },
          this.options.env,
          questionInput.artifactsDir,
        ),
      });
      const artifacts = await this.collectWithRuntimeRoot(handle, questionInput, input.artifactDir);
      const report = await this.normalize(questionInput, artifacts);

      answers.push({
        question,
        answer: report.finalOutput,
        sessionId: report.sessionId,
        startedAt: report.startedAt,
        endedAt: report.endedAt,
        durationMs: report.durationMs,
        rawArtifacts: report.rawArtifacts,
      });
    }

    return { answers };
  }

  private createPromptArgs(prompt: string, cwd: string): string[] {
    return [
      ...(this.options.commandArgs ?? []),
      "-p",
      prompt,
      ...(this.options.model === undefined ? [] : ["--model", this.options.model]),
      "--output-format",
      "json",
      "--stream",
      "on",
      "--no-auto-update",
      "--no-custom-instructions",
      "--disable-builtin-mcps",
      "--no-remote",
      "--allow-all-tools",
      "--disallow-temp-dir",
      "-C",
      cwd,
    ];
  }

  async collect(handle: RunHandle, input: RunInput): Promise<RawRunArtifacts> {
    return this.collectWithRuntimeRoot(handle, input, input.artifactsDir);
  }

  private async collectWithRuntimeRoot(
    handle: RunHandle,
    input: RunInput,
    runtimeArtifactsDir: string,
  ): Promise<RawRunArtifacts> {
    const stdout = await readFile(handle.stdoutPath, "utf8");
    const stderr = await readFile(handle.stderrPath, "utf8");
    const records = parseJsonLines(stdout);
    const exportPath = path.join(input.artifactsDir, "session.stream.jsonl");
    await writeText(exportPath, stdout);

    const telemetrySourcePath = getCopilotTelemetryPath(input);
    const telemetryText = await readOptionalText(telemetrySourcePath);
    const telemetryPath =
      telemetryText === undefined ? undefined : path.join(input.artifactsDir, "copilot-otel.jsonl");
    if (telemetryText !== undefined && telemetryPath !== undefined) {
      await writeText(telemetryPath, telemetryText);
    }

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
      telemetryPath,
      rawSession: {
        records,
        telemetryRecords: telemetryText === undefined ? [] : parseJsonLines(telemetryText),
      } satisfies CopilotRawSession,
    };
  }

  async normalize(input: RunInput, artifacts: RawRunArtifacts): Promise<SessionReport> {
    const { records, telemetryRecords } = readRawSession(artifacts.rawSession);
    const events: SessionEvent[] = [];
    const observedReads: string[] = [];
    const explicitSkillNames = new Set<string>();
    const toolCallNames = new Map<string, string>();
    let reasoningChars = 0;

    for (const record of records) {
      if (!isRecord(record)) {
        continue;
      }

      const type = readString(record, "type");
      const data = isRecord(record.data) ? record.data : {};
      const at = readString(record, "timestamp");

      if (type === "user.message") {
        const text = readString(data, "content") ?? "";
        if (text.length > 0) {
          events.push({ type: "message", role: "user", text, at });
        }
      }

      if (type === "assistant.message") {
        const text = readString(data, "content") ?? "";
        if (text.length > 0) {
          events.push({
            type: "message",
            role: "assistant",
            phase: mapCopilotPhase(readString(data, "phase")),
            text,
            at,
          });
        }
      }

      if (type === "assistant.reasoning") {
        const text = readString(data, "content") ?? "";
        if (text.length > 0) {
          reasoningChars += text.length;
          events.push({ type: "message", role: "assistant", phase: "thinking", text, at });
        }
      }

      if (type === "tool.execution_start") {
        const toolName = readString(data, "toolName");
        const toolCallId = readString(data, "toolCallId");
        const args = data.arguments;

        if (toolName !== undefined) {
          events.push({ type: "toolCall", tool: toolName, args, at });
          if (toolCallId !== undefined) {
            toolCallNames.set(toolCallId, toolName);
          }
        }

        if (toolName === "skill") {
          const skillName =
            readStringFromUnknown(args, "skill") ?? readStringFromUnknown(args, "name");
          if (skillName !== undefined) {
            explicitSkillNames.add(skillName);
            events.push({ type: "skillSignal", skill: skillName, signal: "tool:skill", at });
          }
        }

        const command = extractCopilotCommand(toolName, args, data);
        if (command !== undefined) {
          events.push({ type: "command", command, at });
        }

        if (toolName === "view") {
          const readPath = resolveReportedPath(readStringFromUnknown(args, "path"), input.cwd);
          if (readPath !== undefined) {
            observedReads.push(readPath);
            events.push({ type: "fileRead", path: readPath, at });
          }
        }
      }

      if (type === "tool.execution_complete") {
        const toolCallId = readString(data, "toolCallId");
        const toolName =
          readString(data, "toolName") ??
          (toolCallId === undefined ? undefined : toolCallNames.get(toolCallId));
        const output = stringifyCopilotToolOutput(data);
        if (output.length > 0) {
          events.push({ type: "toolResult", tool: toolName, output, at });
        }

        const command = extractCopilotCommand(toolName, undefined, data);
        if (command !== undefined) {
          events.push({ type: "command", command, at });
        }
      }
    }

    const usage = extractCopilotUsage(telemetryRecords);
    const uniqueObservedReads = [...new Set(observedReads)];
    const detectedSkills = mergeDetectedSkills(
      inferSkillsFromPaths(uniqueObservedReads),
      [...explicitSkillNames].map((skill) => ({
        skill,
        confidence: "explicit" as const,
        evidence: ["Loaded via skill tool"],
      })),
    );
    const finalOutput =
      [...events]
        .reverse()
        .find(
          (event): event is Extract<SessionEvent, { type: "message" }> =>
            event.type === "message" && event.role === "assistant",
        )?.text ?? artifacts.stdout;
    const totalTokens =
      usage.inputTokens !== undefined && usage.outputTokens !== undefined
        ? usage.inputTokens +
          usage.outputTokens +
          (usage.reasoningTokens ?? 0) -
          (usage.cacheTokens ?? 0)
        : undefined;

    return {
      runner: input.runner,
      sessionId: artifacts.sessionId ?? extractSessionId(records),
      prompt: input.prompt,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens,
        cacheTokens: usage.cacheTokens,
        totalTokens,
        inputChars: input.prompt.length,
        outputChars: finalOutput.length,
        reasoningChars,
        source: {
          input: usage.inputTokens === undefined ? "chars" : "provider",
          output: usage.outputTokens === undefined ? "chars" : "provider",
          reasoning: usage.reasoningTokens === undefined ? "chars" : "provider",
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
        telemetryPath: artifacts.telemetryPath,
      },
    };
  }
}

function createExplainRunInput(input: ExplainInput): RunInput {
  return {
    runner: input.runner,
    prompt: "",
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
    artifactsDir: input.artifactDir,
    showRunnerOutput: input.showRunnerOutput,
  };
}

function createExplainQuestionInput(
  input: RunInput,
  artifactDir: string,
  index: number,
  question: string,
): RunInput {
  return {
    ...input,
    prompt: question,
    artifactsDir: path.join(
      artifactDir,
      "explain",
      `question-${String(index + 1).padStart(2, "0")}`,
    ),
  };
}

async function prepareCopilotRuntime(input: RunInput): Promise<void> {
  await ensureDir(getCopilotHome(input));
}

function getCopilotHome(input: Pick<RunInput, "artifactsDir">): string {
  return path.join(input.artifactsDir, "copilot-home");
}

function getCopilotTelemetryPath(input: Pick<RunInput, "artifactsDir">): string {
  return path.join(input.artifactsDir, "copilot-otel.jsonl");
}

function getCopilotEnv(
  runtimeInput: RunInput,
  userEnv: Record<string, string> | undefined,
  outputArtifactsDir = runtimeInput.artifactsDir,
): Record<string, string> {
  return {
    COPILOT_HOME: getCopilotHome(runtimeInput),
    COPILOT_AUTO_UPDATE: "false",
    NO_COLOR: "1",
    COPILOT_OTEL_FILE_EXPORTER_PATH: getCopilotTelemetryPath({
      ...runtimeInput,
      artifactsDir: outputArtifactsDir,
    }),
    ...userEnv,
  };
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
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

function readRawSession(rawSession: unknown): CopilotRawSession {
  if (Array.isArray(rawSession)) {
    return { records: rawSession, telemetryRecords: [] };
  }

  if (isRecord(rawSession)) {
    return {
      records: Array.isArray(rawSession.records) ? rawSession.records : [],
      telemetryRecords: Array.isArray(rawSession.telemetryRecords)
        ? rawSession.telemetryRecords
        : [],
    };
  }

  return { records: [], telemetryRecords: [] };
}

function extractSessionId(records: unknown[]): string | undefined {
  for (const record of [...records].reverse()) {
    if (!isRecord(record)) {
      continue;
    }

    const data = isRecord(record.data) ? record.data : undefined;
    const sessionId = readString(record, "sessionId") ?? readString(data ?? {}, "sessionId");
    if (sessionId !== undefined) {
      return sessionId;
    }
  }

  return undefined;
}

function mapCopilotPhase(phase: string | undefined): "thinking" | "commentary" | "final" {
  if (phase === "thinking") {
    return "thinking";
  }

  if (phase === "commentary") {
    return "commentary";
  }

  return "final";
}

function extractCopilotCommand(
  toolName: string | undefined,
  args: unknown,
  data: Record<string, unknown>,
): string | undefined {
  if (!isShellLikeTool(toolName)) {
    return undefined;
  }

  return (
    readStringFromUnknown(args, "command") ??
    readStringFromUnknown(readNestedRecord(data, "toolTelemetry", "properties"), "command")
  );
}

function isShellLikeTool(toolName: string | undefined): boolean {
  return (
    toolName === "bash" ||
    toolName === "write_bash" ||
    toolName === "read_bash" ||
    toolName === "stop_bash" ||
    toolName === "list_bash"
  );
}

function stringifyCopilotToolOutput(data: Record<string, unknown>): string {
  const error = data.error;
  if (isRecord(error)) {
    return readString(error, "message") ?? stringifyUnknown(error);
  }

  const result = data.result;
  if (isRecord(result)) {
    return (
      readString(result, "detailedContent") ??
      readString(result, "content") ??
      stringifyUnknown(result)
    );
  }

  return stringifyUnknown(result);
}

function extractCopilotUsage(telemetryRecords: unknown[]): {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheTokens?: number;
} {
  const usageSpans = telemetryRecords
    .filter(isRecord)
    .filter((record) => readString(record, "type") === "span")
    .filter((record) => {
      const attributes = isRecord(record.attributes) ? record.attributes : undefined;
      return readNumber(attributes ?? {}, "gen_ai.usage.input_tokens") !== undefined;
    });
  const invokeSpan =
    usageSpans.find((record) => readString(record, "name") === "invoke_agent") ??
    usageSpans.find((record) => readString(record, "name")?.startsWith("chat "));
  const attributes = isRecord(invokeSpan?.attributes) ? invokeSpan.attributes : {};

  return {
    inputTokens: readNumber(attributes, "gen_ai.usage.input_tokens"),
    outputTokens: readNumber(attributes, "gen_ai.usage.output_tokens"),
    reasoningTokens: readNumber(attributes, "gen_ai.usage.reasoning_output_tokens"),
    cacheTokens: readNumber(attributes, "gen_ai.usage.cache_read_input_tokens"),
  };
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
  a: SessionReport["detectedSkills"][number]["confidence"],
  b: SessionReport["detectedSkills"][number]["confidence"],
): number {
  const order = ["explicit", "strong", "medium", "weak"] as const;
  return order.indexOf(a) - order.indexOf(b);
}

function readNestedRecord(
  record: Record<string, unknown>,
  firstKey: string,
  secondKey: string,
): Record<string, unknown> | undefined {
  const first = record[firstKey];
  if (!isRecord(first)) {
    return undefined;
  }

  const second = first[secondKey];
  return isRecord(second) ? second : undefined;
}

function readStringFromUnknown(value: unknown, key: string): string | undefined {
  return isRecord(value) ? readString(value, key) : undefined;
}

function stringifyUnknown(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}
