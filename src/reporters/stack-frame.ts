import type { SerializedError } from "../domain/result.js";

export interface StackFrameLocation {
  filePath: string;
  line: string;
  column: string;
}

export function extractUserStackFrame(error: SerializedError): StackFrameLocation | undefined {
  if (error.stack === undefined) {
    return undefined;
  }

  const frames = error.stack.split("\n").slice(1);
  for (const frame of frames) {
    const parsed = parseStackFrame(frame);
    if (parsed === undefined) {
      continue;
    }

    if (isInternalStackFrame(parsed.filePath)) {
      continue;
    }

    return parsed;
  }

  return undefined;
}

export function formatStackFrameLocation(location: StackFrameLocation): string {
  return `${location.filePath}:${location.line}:${location.column}`;
}

function parseStackFrame(frame: string): StackFrameLocation | undefined {
  const trimmed = frame.trim().replace(/^at\s+/, "");

  // Strip optional trailing ")" from frames like "funcName (file:line:col)"
  const stripped = trimmed.endsWith(")") ? trimmed.slice(0, -1) : trimmed;

  const lastColon = stripped.lastIndexOf(":");
  if (lastColon === -1) return undefined;
  const column = stripped.slice(lastColon + 1);
  if (!/^\d+$/.test(column)) return undefined;

  const secondLastColon = stripped.lastIndexOf(":", lastColon - 1);
  if (secondLastColon === -1) return undefined;
  const line = stripped.slice(secondLastColon + 1, lastColon);
  if (!/^\d+$/.test(line)) return undefined;

  let filePath = stripped.slice(0, secondLastColon);

  // Handle "funcName (file:line:col)" format — extract path after the last "("
  const openParenIndex = filePath.lastIndexOf("(");
  if (openParenIndex !== -1) {
    filePath = filePath.slice(openParenIndex + 1);
  }

  return { filePath, line, column };
}

function isInternalStackFrame(filePath: string): boolean {
  return filePath.startsWith("node:")
    || filePath.includes("/node:internal/")
    || filePath.includes("/src/assertions/")
    || filePath.includes("/src/runner/")
    || filePath.includes("/src/reporters/")
    || filePath.includes("/node_modules/");
}
