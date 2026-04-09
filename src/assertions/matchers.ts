import assert from "node:assert/strict";
import type { SessionReport, ToolCallEvent } from "../domain/session-report.js";
import type { AssertionOptions, Matcher, ToolCallMatcher } from "./types.js";

export function describeMatcher(matcher: Matcher): string {
  return typeof matcher === "string" ? JSON.stringify(matcher) : matcher.toString();
}

export function describeToolCallMatcher(matcher: ToolCallMatcher): string {
  if (matcher.tool === undefined && matcher.where === undefined) {
    return "<any tool call>";
  }

  const parts: string[] = [];
  if (matcher.tool !== undefined) {
    parts.push(`tool matching ${describeMatcher(matcher.tool)}`);
  }
  if (matcher.where !== undefined) {
    parts.push("custom args predicate");
  }

  return parts.join(" and ");
}

export function matchesText(value: string, matcher: Matcher): boolean {
  if (typeof matcher === "string") {
    return value.includes(matcher);
  }

  matcher.lastIndex = 0;
  return matcher.test(value);
}

export function formatObservedValues(label: string, values: readonly string[]): string {
  if (values.length === 0) {
    return `Observed ${label}: (none)`;
  }

  return `Observed ${label}: ${values.join(" | ")}`;
}

export function formatObservedToolCalls(events: readonly ToolCallEvent[]): string {
  if (events.length === 0) {
    return "Observed tool calls: (none)";
  }

  return `Observed tool calls: ${events.map(formatToolCallEvent).join(" | ")}`;
}

export function composeAssertionMessage(
  detail: string,
  observed: string,
  customMessage?: string,
): string {
  if (customMessage === undefined) {
    return `${detail} ${observed}`;
  }

  return `${customMessage}. ${detail} ${observed}`;
}

export function firstMatchIndex(values: readonly string[], matcher: Matcher): number {
  return values.findIndex((value) => matchesText(value, matcher));
}

export function matchesToolCall(event: ToolCallEvent, matcher: ToolCallMatcher): boolean {
  if (matcher.tool !== undefined && !matchesText(event.tool, matcher.tool)) {
    return false;
  }

  if (matcher.where !== undefined && !matcher.where(event.args, event)) {
    return false;
  }

  return true;
}

export function firstToolCallMatchIndex(events: readonly ToolCallEvent[], matcher: ToolCallMatcher): number {
  return events.findIndex((event) => matchesToolCall(event, matcher));
}

export function countMatches(values: readonly string[], matcher: Matcher): number {
  return values.filter((value) => matchesText(value, matcher)).length;
}

export function countToolCallMatches(events: readonly ToolCallEvent[], matcher: ToolCallMatcher): number {
  return events.filter((event) => matchesToolCall(event, matcher)).length;
}

export function assertIncludes(
  label: string,
  values: readonly string[],
  matcher: Matcher,
  options?: AssertionOptions,
): void {
  assert.ok(
    values.some((value) => matchesText(value, matcher)),
    composeAssertionMessage(
      `Expected ${label} to include a value matching ${describeMatcher(matcher)}.`,
      formatObservedValues(label, values),
      options?.message,
    ),
  );
}

export function assertNotIncludes(
  label: string,
  values: readonly string[],
  matcher: Matcher,
  options?: AssertionOptions,
): void {
  assert.ok(
    values.every((value) => !matchesText(value, matcher)),
    composeAssertionMessage(
      `Expected ${label} not to include a value matching ${describeMatcher(matcher)}.`,
      formatObservedValues(label, values),
      options?.message,
    ),
  );
}

export function assertCount(
  label: string,
  values: readonly string[],
  matcher: Matcher,
  expected: number,
  options?: AssertionOptions,
): void {
  const actual = countMatches(values, matcher);
  assert.equal(
    actual,
    expected,
    composeAssertionMessage(
      `Expected ${label} to have ${expected} value(s) matching ${describeMatcher(matcher)}, but found ${actual}.`,
      formatObservedValues(label, values),
      options?.message,
    ),
  );
}

export function assertAtLeast(
  label: string,
  values: readonly string[],
  matcher: Matcher,
  min: number,
  options?: AssertionOptions,
): void {
  const actual = countMatches(values, matcher);
  assert.ok(
    actual >= min,
    composeAssertionMessage(
      `Expected ${label} to have at least ${min} value(s) matching ${describeMatcher(matcher)}, but found ${actual}.`,
      formatObservedValues(label, values),
      options?.message,
    ),
  );
}

export function assertAtMost(
  label: string,
  values: readonly string[],
  matcher: Matcher,
  max: number,
  options?: AssertionOptions,
): void {
  const actual = countMatches(values, matcher);
  assert.ok(
    actual <= max,
    composeAssertionMessage(
      `Expected ${label} to have at most ${max} value(s) matching ${describeMatcher(matcher)}, but found ${actual}.`,
      formatObservedValues(label, values),
      options?.message,
    ),
  );
}

export function assertBefore(
  label: string,
  values: readonly string[],
  firstMatcher: Matcher,
  secondMatcher: Matcher,
  options?: AssertionOptions,
): void {
  const firstIndex = firstMatchIndex(values, firstMatcher);
  const secondIndex = firstMatchIndex(values, secondMatcher);

  assert.notEqual(
    firstIndex,
    -1,
    composeAssertionMessage(
      `Expected ${label} to contain a value matching ${describeMatcher(firstMatcher)} before ${describeMatcher(secondMatcher)}. First match was not found.`,
      formatObservedValues(label, values),
      options?.message,
    ),
  );

  assert.notEqual(
    secondIndex,
    -1,
    composeAssertionMessage(
      `Expected ${label} to contain a value matching ${describeMatcher(firstMatcher)} before ${describeMatcher(secondMatcher)}. Second match was not found.`,
      formatObservedValues(label, values),
      options?.message,
    ),
  );

  assert.ok(
    firstIndex < secondIndex,
    composeAssertionMessage(
      `Expected ${label} to contain a value matching ${describeMatcher(firstMatcher)} before ${describeMatcher(secondMatcher)}. Found first match at index ${firstIndex} and second match at index ${secondIndex}.`,
      formatObservedValues(label, values),
      options?.message,
    ),
  );
}

export function assertOnly(
  label: string,
  values: readonly string[],
  matchers: readonly Matcher[],
  options?: AssertionOptions,
): void {
  const unexpected = values.filter((value) => !matchers.some((matcher) => matchesText(value, matcher)));

  assert.equal(
    unexpected.length,
    0,
    composeAssertionMessage(
      `Expected ${label} to contain only values matching one of: ${matchers.map(describeMatcher).join(", ") || "(none)"}. Unexpected: ${unexpected.join(" | ") || "(none)"}.`,
      formatObservedValues(label, values),
      options?.message,
    ),
  );
}

export function assertSize(
  label: string,
  values: readonly string[],
  expected: number,
  options?: AssertionOptions,
): void {
  assert.equal(
    values.length,
    expected,
    composeAssertionMessage(
      `Expected ${label} to contain exactly ${expected} value(s), but found ${values.length}.`,
      formatObservedValues(label, values),
      options?.message,
    ),
  );
}

export function assertFirst(
  label: string,
  values: readonly string[],
  matcher: Matcher,
  options?: AssertionOptions,
): void {
  const first = values[0];
  assert.ok(
    first !== undefined && matchesText(first, matcher),
    composeAssertionMessage(
      `Expected the first ${label} value to match ${describeMatcher(matcher)}.`,
      formatObservedValues(label, values),
      options?.message,
    ),
  );
}

export function assertLast(
  label: string,
  values: readonly string[],
  matcher: Matcher,
  options?: AssertionOptions,
): void {
  const last = values.at(-1);
  assert.ok(
    last !== undefined && matchesText(last, matcher),
    composeAssertionMessage(
      `Expected the last ${label} value to match ${describeMatcher(matcher)}.`,
      formatObservedValues(label, values),
      options?.message,
    ),
  );
}

export function assertToolCallHas(
  events: readonly ToolCallEvent[],
  matcher: ToolCallMatcher,
  options?: AssertionOptions,
): void {
  assert.ok(
    events.some((event) => matchesToolCall(event, matcher)),
    composeAssertionMessage(
      `Expected tool calls to include ${describeToolCallMatcher(matcher)}.`,
      formatObservedToolCalls(events),
      options?.message,
    ),
  );
}

export function assertToolCallCount(
  events: readonly ToolCallEvent[],
  matcher: ToolCallMatcher,
  expected: number,
  options?: AssertionOptions,
): void {
  const actual = countToolCallMatches(events, matcher);
  assert.equal(
    actual,
    expected,
    composeAssertionMessage(
      `Expected tool calls to have ${expected} match(es) for ${describeToolCallMatcher(matcher)}, but found ${actual}.`,
      formatObservedToolCalls(events),
      options?.message,
    ),
  );
}

export function assertToolCallAtLeast(
  events: readonly ToolCallEvent[],
  matcher: ToolCallMatcher,
  min: number,
  options?: AssertionOptions,
): void {
  const actual = countToolCallMatches(events, matcher);
  assert.ok(
    actual >= min,
    composeAssertionMessage(
      `Expected tool calls to have at least ${min} match(es) for ${describeToolCallMatcher(matcher)}, but found ${actual}.`,
      formatObservedToolCalls(events),
      options?.message,
    ),
  );
}

export function assertToolCallAtMost(
  events: readonly ToolCallEvent[],
  matcher: ToolCallMatcher,
  max: number,
  options?: AssertionOptions,
): void {
  const actual = countToolCallMatches(events, matcher);
  assert.ok(
    actual <= max,
    composeAssertionMessage(
      `Expected tool calls to have at most ${max} match(es) for ${describeToolCallMatcher(matcher)}, but found ${actual}.`,
      formatObservedToolCalls(events),
      options?.message,
    ),
  );
}

export function assertToolCallBefore(
  events: readonly ToolCallEvent[],
  firstMatcher: ToolCallMatcher,
  secondMatcher: ToolCallMatcher,
  options?: AssertionOptions,
): void {
  const firstIndex = firstToolCallMatchIndex(events, firstMatcher);
  const secondIndex = firstToolCallMatchIndex(events, secondMatcher);

  assert.notEqual(
    firstIndex,
    -1,
    composeAssertionMessage(
      `Expected tool calls to contain ${describeToolCallMatcher(firstMatcher)} before ${describeToolCallMatcher(secondMatcher)}. First match was not found.`,
      formatObservedToolCalls(events),
      options?.message,
    ),
  );

  assert.notEqual(
    secondIndex,
    -1,
    composeAssertionMessage(
      `Expected tool calls to contain ${describeToolCallMatcher(firstMatcher)} before ${describeToolCallMatcher(secondMatcher)}. Second match was not found.`,
      formatObservedToolCalls(events),
      options?.message,
    ),
  );

  assert.ok(
    firstIndex < secondIndex,
    composeAssertionMessage(
      `Expected tool calls to contain ${describeToolCallMatcher(firstMatcher)} before ${describeToolCallMatcher(secondMatcher)}. Found first match at index ${firstIndex} and second match at index ${secondIndex}.`,
      formatObservedToolCalls(events),
      options?.message,
    ),
  );
}

export function assertToolCallSequence(
  events: readonly ToolCallEvent[],
  matchers: readonly ToolCallMatcher[],
  options?: AssertionOptions,
): void {
  let previousIndex = -1;

  for (const matcher of matchers) {
    const nextIndex = events.findIndex((event, index) => index > previousIndex && matchesToolCall(event, matcher));
    assert.notEqual(
      nextIndex,
      -1,
      composeAssertionMessage(
        `Expected tool calls to contain the sequence ${matchers.map(describeToolCallMatcher).join(" -> ")}, but ${describeToolCallMatcher(matcher)} was not found after index ${previousIndex}.`,
        formatObservedToolCalls(events),
        options?.message,
      ),
    );
    previousIndex = nextIndex;
  }
}

export function assertToolCallOnly(
  events: readonly ToolCallEvent[],
  matchers: readonly ToolCallMatcher[],
  options?: AssertionOptions,
): void {
  const unexpected = events.filter((event) => !matchers.some((matcher) => matchesToolCall(event, matcher)));

  assert.equal(
    unexpected.length,
    0,
    composeAssertionMessage(
      `Expected tool calls to contain only matches from: ${matchers.map(describeToolCallMatcher).join(", ") || "(none)"}. Unexpected: ${unexpected.map(formatToolCallEvent).join(" | ") || "(none)"}.`,
      formatObservedToolCalls(events),
      options?.message,
    ),
  );
}

export function getCommands(report: SessionReport): string[] {
  return report.events
    .filter((event): event is Extract<(typeof report.events)[number], { type: "command" }> => event.type === "command")
    .map((event) => event.command);
}

export function getFileReads(report: SessionReport): string[] {
  const fileReadEvents = report.events
    .filter((event): event is Extract<(typeof report.events)[number], { type: "fileRead" }> => event.type === "fileRead")
    .map((event) => event.path);

  return fileReadEvents.length > 0 ? fileReadEvents : report.files.observedReads;
}

export function getToolCalls(report: SessionReport): ToolCallEvent[] {
  return report.events.filter((event): event is ToolCallEvent => event.type === "toolCall");
}

function formatToolCallEvent(event: ToolCallEvent): string {
  const args = event.args === undefined ? "" : ` ${safeStringify(event.args)}`;
  return `${event.tool}${args}`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
