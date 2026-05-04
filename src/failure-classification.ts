import type { FailureClass, RunnerFailureOrigin, RunnerFailureType } from "./domain/result.js";

const FAILURE_CLASS_SYMBOL = Symbol.for("skillgym.failureClass");

export type FailureClassInput = string | FailureClass;

type ErrorWithFailureClass = Error & {
  [FAILURE_CLASS_SYMBOL]?: FailureClass;
};

export function normalizeFailureClass(input: FailureClassInput): FailureClass {
  if (typeof input === "string") {
    return { id: input };
  }

  return input.label === undefined ? { id: input.id } : { id: input.id, label: input.label };
}

export function attachFailureClass(error: unknown, input: FailureClassInput): void {
  if (!(error instanceof Error)) {
    return;
  }

  (error as ErrorWithFailureClass)[FAILURE_CLASS_SYMBOL] = normalizeFailureClass(input);
}

export function getAttachedFailureClass(error: unknown): FailureClass | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  return (error as ErrorWithFailureClass)[FAILURE_CLASS_SYMBOL];
}

export function resolveFailureClass(options: {
  failureClass?: FailureClassInput;
  failureType?: RunnerFailureType;
  failureOrigin?: RunnerFailureOrigin;
}): FailureClass | undefined {
  if (options.failureClass !== undefined) {
    return normalizeFailureClass(options.failureClass);
  }

  if (options.failureType === "assertion") {
    return { id: "assertion", label: "Assertion failure" };
  }

  if (options.failureType === "timeout") {
    return { id: "timeout", label: "Timeout" };
  }

  switch (options.failureOrigin) {
    case "assert-hook":
      return { id: "assert-hook", label: "Assert hook crash" };
    case "max-steps":
      return { id: "max-steps", label: "Max steps exceeded" };
    case "model-rejected":
      return { id: "model-rejected", label: "Rejected model" };
    case "workspace-bootstrap":
      return { id: "workspace-bootstrap", label: "Workspace bootstrap" };
    case "workspace-setup":
      return { id: "workspace-setup", label: "Workspace setup" };
    case "collection":
      return { id: "collection", label: "Artifact collection" };
    case "normalization":
      return { id: "normalization", label: "Report normalization" };
    case "snapshot":
      return { id: "snapshot", label: "Snapshot verification" };
    case "runner":
      return { id: "runner-crash", label: "Runner crash" };
    case "assertion":
      return { id: "assertion", label: "Assertion failure" };
    case undefined:
      return options.failureType === "runner-crash"
        ? { id: "runner-crash", label: "Runner crash" }
        : undefined;
  }
}
