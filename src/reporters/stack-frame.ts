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
  const match = /\(?(.+):(\d+):(\d+)\)?$/.exec(trimmed);
  if (match === null) {
    return undefined;
  }

  let [, filePath, line, column] = match;
  if (filePath === undefined || line === undefined || column === undefined) {
    return undefined;
  }

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
