import { AsyncLocalStorage } from "node:async_hooks";
import { AssertionError } from "node:assert";
import nodeAssert from "node:assert/strict";
import { commandAssertions } from "./commands.js";
import { fileReadAssertions } from "./file-reads.js";
import { outputAssertions } from "./output.js";
import { skillAssertions } from "./skills.js";
import { toolCallAssertions } from "./tool-calls.js";
import type {
  CommandAssertions,
  FileReadAssertions,
  OutputAssertions,
  SkillAssertions,
  SkillGymSoftAssert,
  ToolCallAssertions,
} from "./types.js";

interface SoftAssertionCollector {
  failures: AssertionError[];
}

type VoidFunction = (...args: any[]) => void;
type SoftGroup<T> = {
  [K in keyof T]: T[K] extends (...args: infer Args) => void ? (...args: Args) => void : never;
};

const softAssertionStorage = new AsyncLocalStorage<SoftAssertionCollector>();

const softAssertionGroups = {
  skills: createSoftGroup(skillAssertions),
  commands: createSoftGroup(commandAssertions),
  fileReads: createSoftGroup(fileReadAssertions),
  toolCalls: createSoftGroup(toolCallAssertions),
  output: createSoftGroup(outputAssertions),
} satisfies {
  skills: SkillAssertions;
  commands: CommandAssertions;
  fileReads: FileReadAssertions;
  toolCalls: ToolCallAssertions;
  output: OutputAssertions;
};

export const softAssert: SkillGymSoftAssert = Object.assign(createSoftNodeAssert(), softAssertionGroups);

export async function runWithSoftAssertions<T>(callback: () => Promise<T> | T): Promise<T> {
  return await softAssertionStorage.run({ failures: [] }, async () => {
    try {
      const result = await callback();
      flushSoftAssertions();
      return result;
    } catch (error) {
      if (error instanceof AssertionError) {
        throw mergeCollectedSoftAssertions(error);
      }

      throw error;
    }
  });
}

function createSoftNodeAssert(): typeof nodeAssert {
  const wrapped = ((...args: Parameters<typeof nodeAssert>) =>
    captureSoftAssertion(() => nodeAssert(...args))) as typeof nodeAssert;

  for (const key of Object.getOwnPropertyNames(nodeAssert)) {
    if (key === "length" || key === "name" || key === "prototype") {
      continue;
    }

    const descriptor = Object.getOwnPropertyDescriptor(nodeAssert, key);
    if (descriptor === undefined) {
      continue;
    }

    if ("value" in descriptor) {
      if (key === "strict") {
        descriptor.value = wrapped;
      } else if (typeof descriptor.value === "function" && key !== "rejects" && key !== "doesNotReject") {
        const method = descriptor.value;
        descriptor.value = (...args: unknown[]) => captureSoftAssertion(() => method.apply(nodeAssert, args));
      }
    }

    Object.defineProperty(wrapped, key, descriptor);
  }

  return wrapped;
}

function createSoftGroup<T extends object>(group: T): SoftGroup<T> {
  const wrappedGroup = {} as SoftGroup<T>;

  for (const key of Object.keys(group) as Array<keyof T>) {
    const method = group[key];
    if (typeof method !== "function") {
      continue;
    }

    wrappedGroup[key] = ((...args: unknown[]) =>
      captureSoftAssertion(() => (method as VoidFunction)(...args))) as SoftGroup<T>[typeof key];
  }

  return wrappedGroup;
}

function captureSoftAssertion<T>(callback: () => T): T {
  try {
    return callback();
  } catch (error) {
    if (!(error instanceof AssertionError)) {
      throw error;
    }

    const collector = softAssertionStorage.getStore();
    if (collector === undefined) {
      throw error;
    }

    collector.failures.push(error);
    return undefined as T;
  }
}

function flushSoftAssertions(): void {
  const collector = softAssertionStorage.getStore();
  if (collector === undefined || collector.failures.length === 0) {
    return;
  }

  throw createAggregateAssertionError(collector.failures.splice(0));
}

function mergeCollectedSoftAssertions(hardFailure: AssertionError): AssertionError {
  const collector = softAssertionStorage.getStore();
  if (collector === undefined || collector.failures.length === 0) {
    return hardFailure;
  }

  return createAggregateAssertionError([...collector.failures.splice(0), hardFailure]);
}

function createAggregateAssertionError(failures: readonly AssertionError[]): AssertionError {
  const count = failures.length;
  const message = [
    `${count} assertion failure${count === 1 ? "" : "s"} collected during test case execution:`,
    ...failures.map((failure, index) => `${index + 1}. ${failure.message}`),
  ].join("\n");

  const error = new AssertionError({
    message,
    actual: count,
    expected: 0,
    operator: "softAssertions",
  });

  error.stack = [
    `${error.name}: ${message}`,
    ...failures.map((failure, index) => {
      const stack = failure.stack ?? `${failure.name}: ${failure.message}`;
      return `Assertion ${index + 1}\n${stack}`;
    }),
  ].join("\n\n");

  return error;
}
