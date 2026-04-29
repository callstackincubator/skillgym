import assert from "node:assert/strict";
import type {
  AssertionOptions,
  CommandMatcher,
  CommandMatcherBuilderLike,
  CommandValueMatcher,
  Matcher,
  StructuredCommandMatcher,
} from "./types.js";
import { composeAssertionMessage, describeMatcher, formatObservedValues, matchesText } from "./matchers.js";

type ParsedCommandValue = string | true;

interface NormalizedCommandMatcher {
  executable?: Matcher;
  positionals: readonly Matcher[];
  options: ReadonlyMap<string, readonly CommandValueMatcher[]>;
  endOfOptions?: boolean;
  strict: boolean;
}

interface ParsedCommand {
  raw: string;
  executable?: string;
  positionals: readonly string[];
  options: ReadonlyMap<string, readonly ParsedCommandValue[]>;
  endOfOptions: boolean;
  normalizedFromShell: boolean;
}

export class CommandMatcherBuilder implements CommandMatcherBuilderLike {
  private executableMatcher?: Matcher;
  private readonly positionalMatchers: Matcher[] = [];
  private readonly optionMatchers = new Map<string, CommandValueMatcher[]>();
  private hasEndOfOptions?: boolean;
  private isStrict = false;

  constructor(executable?: Matcher) {
    this.executableMatcher = executable;
  }

  executable(matcher: Matcher): this {
    this.executableMatcher = matcher;
    return this;
  }

  arg(matcher: Matcher): this {
    this.positionalMatchers.push(matcher);
    return this;
  }

  args(...matchers: readonly Matcher[]): this {
    this.positionalMatchers.push(...matchers);
    return this;
  }

  option(name: string, value: CommandValueMatcher = true): this {
    const values = this.optionMatchers.get(name) ?? [];
    values.push(value);
    this.optionMatchers.set(name, values);
    return this;
  }

  flag(name: string): this {
    return this.option(name, true);
  }

  endOfOptions(): this {
    this.hasEndOfOptions = true;
    return this;
  }

  exact(): this {
    this.isStrict = true;
    return this;
  }

  strict(): this {
    this.isStrict = true;
    return this;
  }

  build(): StructuredCommandMatcher {
    const options =
      this.optionMatchers.size === 0
        ? undefined
        : (Object.fromEntries([...this.optionMatchers.entries()].map(([name, values]) => [name, values.length === 1 ? values[0] : [...values]])) as Readonly<
            Record<string, CommandValueMatcher | readonly CommandValueMatcher[]>
          >);

    return {
      executable: this.executableMatcher,
      positionals: [...this.positionalMatchers],
      options,
      endOfOptions: this.hasEndOfOptions,
      strict: this.isStrict,
    };
  }
}

export function commandMatcher(executable?: Matcher): CommandMatcherBuilder {
  return new CommandMatcherBuilder(executable);
}

export function parseCommand(command: string): ParsedCommand {
  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) {
    return {
      raw: command,
      executable: undefined,
      positionals: [],
      options: new Map(),
      endOfOptions: false,
      normalizedFromShell: false,
    };
  }

  const unwrapped = unwrapShellCommand(tokens);
  const parsedTokens = unwrapped === undefined ? tokens : tokenizeCommand(unwrapped.command);
  const parsed = parseCommandTokens(parsedTokens);

  return {
    raw: command,
    executable: parsed.executable,
    positionals: parsed.positionals,
    options: parsed.options,
    endOfOptions: parsed.endOfOptions,
    normalizedFromShell: unwrapped !== undefined,
  };
}

export function describeCommandMatcher(matcher: CommandMatcher): string {
  if (typeof matcher === "string" || matcher instanceof RegExp) {
    return describeMatcher(matcher);
  }

  const normalized = normalizeCommandMatcher(matcher);
  const parts: string[] = [];

  if (normalized.executable !== undefined) {
    parts.push(`executable=${describeMatcher(normalized.executable)}`);
  }
  if (normalized.positionals.length > 0) {
    parts.push(`positionals=[${normalized.positionals.map(describeMatcher).join(", ")}]`);
  }
  if (normalized.options.size > 0) {
    parts.push(
      `options={${[...normalized.options.entries()]
        .map(([name, values]) => `${name}: [${values.map((value) => (value === true ? "<flag>" : describeMatcher(value))).join(", ")}]`)
        .join(", ")}}`,
    );
  }
  if (normalized.endOfOptions !== undefined) {
    parts.push(`endOfOptions=${String(normalized.endOfOptions)}`);
  }
  if (normalized.strict) {
    parts.push("strict=true");
  }

  return `command matcher (${parts.join(", ") || "<any>"})`;
}

export function matchesCommand(command: string, matcher: CommandMatcher): boolean {
  if (typeof matcher === "string" || matcher instanceof RegExp) {
    return matchesText(command, matcher);
  }

  return matchesParsedCommand(parseCommand(command), normalizeCommandMatcher(matcher));
}

export function firstCommandMatchIndex(commands: readonly string[], matcher: CommandMatcher): number {
  return commands.findIndex((command) => matchesCommand(command, matcher));
}

export function countCommandMatches(commands: readonly string[], matcher: CommandMatcher): number {
  return commands.filter((command) => matchesCommand(command, matcher)).length;
}

export function assertCommandIncludes(commands: readonly string[], matcher: CommandMatcher, options?: AssertionOptions): void {
  assert.ok(
    commands.some((command) => matchesCommand(command, matcher)),
    composeAssertionMessage(
      `Expected commands to include a value matching ${describeCommandMatcher(matcher)}.`,
      formatObservedCommands(commands),
      options?.message,
    ),
  );
}

export function assertCommandNotIncludes(commands: readonly string[], matcher: CommandMatcher, options?: AssertionOptions): void {
  assert.ok(
    commands.every((command) => !matchesCommand(command, matcher)),
    composeAssertionMessage(
      `Expected commands not to include a value matching ${describeCommandMatcher(matcher)}.`,
      formatObservedCommands(commands),
      options?.message,
    ),
  );
}

export function assertCommandCount(commands: readonly string[], matcher: CommandMatcher, expected: number, options?: AssertionOptions): void {
  const actual = countCommandMatches(commands, matcher);
  assert.equal(
    actual,
    expected,
    composeAssertionMessage(
      `Expected commands to have ${expected} value(s) matching ${describeCommandMatcher(matcher)}, but found ${actual}.`,
      formatObservedCommands(commands),
      options?.message,
    ),
  );
}

export function assertCommandAtLeast(commands: readonly string[], matcher: CommandMatcher, min: number, options?: AssertionOptions): void {
  const actual = countCommandMatches(commands, matcher);
  assert.ok(
    actual >= min,
    composeAssertionMessage(
      `Expected commands to have at least ${min} value(s) matching ${describeCommandMatcher(matcher)}, but found ${actual}.`,
      formatObservedCommands(commands),
      options?.message,
    ),
  );
}

export function assertCommandAtMost(commands: readonly string[], matcher: CommandMatcher, max: number, options?: AssertionOptions): void {
  const actual = countCommandMatches(commands, matcher);
  assert.ok(
    actual <= max,
    composeAssertionMessage(
      `Expected commands to have at most ${max} value(s) matching ${describeCommandMatcher(matcher)}, but found ${actual}.`,
      formatObservedCommands(commands),
      options?.message,
    ),
  );
}

export function assertCommandBefore(
  commands: readonly string[],
  firstMatcher: CommandMatcher,
  secondMatcher: CommandMatcher,
  options?: AssertionOptions,
): void {
  const firstIndex = firstCommandMatchIndex(commands, firstMatcher);
  const secondIndex = firstCommandMatchIndex(commands, secondMatcher);

  assert.notEqual(
    firstIndex,
    -1,
    composeAssertionMessage(
      `Expected commands to contain a value matching ${describeCommandMatcher(firstMatcher)} before ${describeCommandMatcher(secondMatcher)}. First match was not found.`,
      formatObservedCommands(commands),
      options?.message,
    ),
  );

  assert.notEqual(
    secondIndex,
    -1,
    composeAssertionMessage(
      `Expected commands to contain a value matching ${describeCommandMatcher(firstMatcher)} before ${describeCommandMatcher(secondMatcher)}. Second match was not found.`,
      formatObservedCommands(commands),
      options?.message,
    ),
  );

  assert.ok(
    firstIndex < secondIndex,
    composeAssertionMessage(
      `Expected commands to contain a value matching ${describeCommandMatcher(firstMatcher)} before ${describeCommandMatcher(secondMatcher)}. Found first match at index ${firstIndex} and second match at index ${secondIndex}.`,
      formatObservedCommands(commands),
      options?.message,
    ),
  );
}

export function assertCommandOnly(commands: readonly string[], matchers: readonly CommandMatcher[], options?: AssertionOptions): void {
  const unexpected = commands.filter((command) => !matchers.some((matcher) => matchesCommand(command, matcher)));

  assert.equal(
    unexpected.length,
    0,
    composeAssertionMessage(
      `Expected commands to contain only values matching one of: ${matchers.map(describeCommandMatcher).join(", ") || "(none)"}. Unexpected: ${unexpected.join(" | ") || "(none)"}.`,
      formatObservedCommands(commands),
      options?.message,
    ),
  );
}

export function assertCommandFirst(commands: readonly string[], matcher: CommandMatcher, options?: AssertionOptions): void {
  const first = commands[0];
  assert.ok(
    first !== undefined && matchesCommand(first, matcher),
    composeAssertionMessage(
      `Expected the first commands value to match ${describeCommandMatcher(matcher)}.`,
      formatObservedCommands(commands),
      options?.message,
    ),
  );
}

export function assertCommandLast(commands: readonly string[], matcher: CommandMatcher, options?: AssertionOptions): void {
  const last = commands.at(-1);
  assert.ok(
    last !== undefined && matchesCommand(last, matcher),
    composeAssertionMessage(
      `Expected the last commands value to match ${describeCommandMatcher(matcher)}.`,
      formatObservedCommands(commands),
      options?.message,
    ),
  );
}

function normalizeCommandMatcher(matcher: StructuredCommandMatcher | CommandMatcherBuilderLike): NormalizedCommandMatcher {
  const source = "build" in matcher ? matcher.build() : matcher;
  const options = new Map<string, CommandValueMatcher[]>();

  for (const [name, value] of Object.entries(source.options ?? {})) {
    options.set(name, Array.isArray(value) ? [...value] : [value]);
  }

  return {
    executable: source.executable,
    positionals: source.positionals ?? [],
    options,
    endOfOptions: source.endOfOptions,
    strict: source.strict === true || source.exact === true,
  };
}

function matchesParsedCommand(parsed: ParsedCommand, matcher: NormalizedCommandMatcher): boolean {
  if (matcher.executable !== undefined && !matchesToken(parsed.executable, matcher.executable)) {
    return false;
  }

  if (!matchesPositionals(parsed.positionals, matcher.positionals, matcher.strict)) {
    return false;
  }

  if (!matchesOptions(parsed.options, matcher.options, matcher.strict)) {
    return false;
  }

  if (matcher.endOfOptions !== undefined && parsed.endOfOptions !== matcher.endOfOptions) {
    return false;
  }

  return true;
}

function matchesPositionals(observed: readonly string[], expected: readonly Matcher[], strict: boolean): boolean {
  if (expected.length === 0) {
    return strict ? observed.length === 0 : true;
  }

  if (strict && observed.length !== expected.length) {
    return false;
  }

  if (strict) {
    return expected.every((matcher, index) => matchesToken(observed[index], matcher));
  }

  let observedIndex = 0;
  for (const matcher of expected) {
    while (observedIndex < observed.length && !matchesToken(observed[observedIndex], matcher)) {
      observedIndex += 1;
    }

    if (observedIndex === observed.length) {
      return false;
    }

    observedIndex += 1;
  }

  return true;
}

function matchesOptions(
  observed: ReadonlyMap<string, readonly ParsedCommandValue[]>,
  expected: ReadonlyMap<string, readonly CommandValueMatcher[]>,
  strict: boolean,
): boolean {
  for (const [name, expectedValues] of expected.entries()) {
    const observedValues = observed.get(name);
    if (observedValues === undefined) {
      return false;
    }

    if (!matchesOptionValues(observedValues, expectedValues, strict)) {
      return false;
    }
  }

  if (!strict) {
    return true;
  }

  if (observed.size !== expected.size) {
    return false;
  }

  for (const name of observed.keys()) {
    if (!expected.has(name)) {
      return false;
    }
  }

  return true;
}

function matchesOptionValues(observed: readonly ParsedCommandValue[], expected: readonly CommandValueMatcher[], strict: boolean): boolean {
  if (strict && observed.length !== expected.length) {
    return false;
  }

  if (expected.length > observed.length) {
    return false;
  }

  const used = new Set<number>();
  for (const expectedValue of expected) {
    const matchedIndex = observed.findIndex((observedValue, index) => !used.has(index) && matchesOptionValue(observedValue, expectedValue));
    if (matchedIndex === -1) {
      return false;
    }
    used.add(matchedIndex);
  }

  return !strict || used.size === observed.length;
}

function matchesOptionValue(observed: ParsedCommandValue, expected: CommandValueMatcher): boolean {
  if (expected === true || observed === true) {
    return expected === observed;
  }

  return matchesToken(observed, expected);
}

function matchesToken(value: string | undefined, matcher: Matcher): boolean {
  if (value === undefined) {
    return false;
  }

  if (typeof matcher === "string") {
    return value === matcher;
  }

  matcher.lastIndex = 0;
  return matcher.test(value);
}

function formatObservedCommands(commands: readonly string[]): string {
  if (commands.length === 0) {
    return formatObservedValues("commands", commands);
  }

  return `Observed commands: ${commands.map(formatObservedCommand).join(" | ")}`;
}

function formatObservedCommand(command: string): string {
  const parsed = parseCommand(command);
  const parts: string[] = [];

  if (parsed.executable !== undefined) {
    parts.push(`executable=${JSON.stringify(parsed.executable)}`);
  }
  if (parsed.positionals.length > 0) {
    parts.push(`positionals=${JSON.stringify(parsed.positionals)}`);
  }
  if (parsed.options.size > 0) {
    parts.push(`options=${JSON.stringify(Object.fromEntries(parsed.options.entries()))}`);
  }
  if (parsed.endOfOptions) {
    parts.push("endOfOptions=true");
  }

  if (parts.length === 0 && !parsed.normalizedFromShell) {
    return command;
  }

  return `${command}${parsed.normalizedFromShell ? " normalized from shell wrapper" : " parsed"} (${parts.join(", ") || "empty"})`;
}

function unwrapShellCommand(tokens: readonly string[]): { command: string } | undefined {
  const shellIndex = findShellIndex(tokens);
  if (shellIndex === -1) {
    return undefined;
  }

  for (let index = shellIndex + 1; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    const nextToken = tokens[index + 1];
    if (token === undefined || nextToken === undefined) {
      continue;
    }

    if (token.startsWith("-") && token.includes("c")) {
      return { command: nextToken };
    }
  }

  return undefined;
}

function findShellIndex(tokens: readonly string[]): number {
  for (let index = 0; index < Math.min(tokens.length, 2); index += 1) {
    const value = tokens[index];
    if (value === undefined) {
      continue;
    }

    const token = basename(value);
    if (token === "env") {
      continue;
    }

    if (SHELL_EXECUTABLES.has(token)) {
      return index;
    }
  }

  return -1;
}

function basename(value: string): string {
  const parts = value.split(/[\\/]/);
  return parts[parts.length - 1] ?? value;
}

function parseCommandTokens(tokens: readonly string[]): Omit<ParsedCommand, "raw" | "normalizedFromShell"> {
  const executable = tokens[0];
  const positionals: string[] = [];
  const options = new Map<string, ParsedCommandValue[]>();
  let endOfOptions = false;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }

    if (!endOfOptions && token === "--") {
      endOfOptions = true;
      continue;
    }

    if (!endOfOptions && token.startsWith("--") && token.length > 2) {
      const equalsIndex = token.indexOf("=");
      if (equalsIndex !== -1) {
        pushOption(options, token.slice(0, equalsIndex), token.slice(equalsIndex + 1));
        continue;
      }

      const nextToken = tokens[index + 1];
      if (shouldTreatAsOptionValue(nextToken)) {
        pushOption(options, token, nextToken);
        index += 1;
        continue;
      }

      pushOption(options, token, true);
      continue;
    }

    if (!endOfOptions && token.startsWith("-") && token.length > 1) {
      if (/^-[A-Za-z]+$/.test(token) && token.length > 2) {
        for (const shortFlag of token.slice(1)) {
          pushOption(options, `-${shortFlag}`, true);
        }
        continue;
      }

      if (token.length > 2) {
        pushOption(options, token.slice(0, 2), token.slice(2));
        continue;
      }

      const nextToken = tokens[index + 1];
      if (shouldTreatAsOptionValue(nextToken)) {
        pushOption(options, token, nextToken);
        index += 1;
        continue;
      }

      pushOption(options, token, true);
      continue;
    }

    positionals.push(token);
  }

  return {
    executable,
    positionals,
    options,
    endOfOptions,
  };
}

function shouldTreatAsOptionValue(token: string | undefined): token is string {
  return token !== undefined && token !== "--" && !token.startsWith("-");
}

function pushOption(options: Map<string, ParsedCommandValue[]>, name: string, value: ParsedCommandValue): void {
  const values = options.get(name) ?? [];
  values.push(value);
  options.set(name, values);
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (char === undefined) {
      continue;
    }

    if (quote === undefined && /\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    if (char === "\\" && quote !== "'") {
      const next = command[index + 1];
      if (next !== undefined) {
        current += next;
        index += 1;
        continue;
      }
    }

    if (char === "'" || char === '"') {
      if (quote === char) {
        quote = undefined;
        continue;
      }

      if (quote === undefined) {
        quote = char;
        continue;
      }
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

const SHELL_EXECUTABLES = new Set(["bash", "sh", "zsh", "fish", "dash"]);
