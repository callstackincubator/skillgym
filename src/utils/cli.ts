export interface ParsedArgs {
  command: string;
  positionals: string[];
  options: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];

    if (value === undefined) {
      continue;
    }

    if (value.startsWith("--")) {
      const withoutPrefix = value.slice(2);
      const eqIndex = withoutPrefix.indexOf("=");

      if (eqIndex >= 0) {
        options[withoutPrefix.slice(0, eqIndex)] = withoutPrefix.slice(eqIndex + 1);
        continue;
      }

      const next = rest[index + 1];

      if (next !== undefined && !next.startsWith("--")) {
        options[withoutPrefix] = next;
        index += 1;
      } else {
        options[withoutPrefix] = true;
      }

      continue;
    }

    positionals.push(value);
  }

  return { command, positionals, options };
}
