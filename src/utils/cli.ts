export interface ParsedArgs {
  command: string;
  positionals: string[];
  options: Record<string, string | boolean | string[]>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const positionals: string[] = [];
  const options: Record<string, string | boolean | string[]> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];

    if (value === undefined) {
      continue;
    }

    if (value.startsWith("--")) {
      const withoutPrefix = value.slice(2);
      const eqIndex = withoutPrefix.indexOf("=");

      if (eqIndex >= 0) {
        setOption(options, withoutPrefix.slice(0, eqIndex), withoutPrefix.slice(eqIndex + 1));
        continue;
      }

      const next = rest[index + 1];

      if (next !== undefined && !next.startsWith("--")) {
        setOption(options, withoutPrefix, next);
        index += 1;
      } else {
        setOption(options, withoutPrefix, true);
      }

      continue;
    }

    positionals.push(value);
  }

  return { command, positionals, options };
}

function setOption(
  options: Record<string, string | boolean | string[]>,
  key: string,
  value: string | boolean,
): void {
  const current = options[key];

  if (current === undefined) {
    options[key] = value;
    return;
  }

  if (Array.isArray(current)) {
    if (typeof value === "string") {
      current.push(value);
    } else {
      options[key] = value;
    }
    return;
  }

  if (typeof value === "boolean") {
    options[key] = value;
    return;
  }

  if (typeof current === "string" && typeof value === "string") {
    options[key] = [current, value];
  }
}
