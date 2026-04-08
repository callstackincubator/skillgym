import process from "node:process";

type Writer = Pick<NodeJS.WriteStream, "write" | "isTTY">;

interface CliTheme {
  accent(value: string): string;
  bold(value: string): string;
  dim(value: string): string;
  light(value: string): string;
}

const RESET = "\x1b[0m";

function wrap(enabled: boolean, code: string, value: string): string {
  return enabled ? `${code}${value}${RESET}` : value;
}

export function createCliTheme(stdout: Pick<NodeJS.WriteStream, "isTTY"> = process.stdout): CliTheme {
  const enabled = Boolean(stdout.isTTY);

  return {
    accent(value) {
      return wrap(enabled, "\x1b[38;5;141m", value);
    },
    bold(value) {
      return wrap(enabled, "\x1b[1m", value);
    },
    dim(value) {
      return wrap(enabled, "\x1b[38;5;102m", value);
    },
    light(value) {
      return wrap(enabled, "\x1b[38;5;145m", value);
    },
  };
}

export function printBanner(options: {
  kind: "compact" | "full";
  stdout?: Writer;
}): void {
  const stdout = options.stdout ?? process.stdout;
  const theme = createCliTheme(stdout);

  writeLine("", stdout);
  writeLine(theme.bold("skillgym"), stdout);
  writeLine(theme.accent("Prove your agent skills work before you ship them."), stdout);
  writeLine("", stdout);

  if (options.kind === "full") {
    writeLine(`  ${theme.dim("$")} ${theme.light("skillgym run")} ${theme.accent("<suite.ts>")}        ${theme.dim("Run a benchmark suite")}`, stdout);
    writeLine(
      `  ${theme.dim("$")} ${theme.light("skillgym run")} ${theme.accent("<suite.ts>")} ${theme.light("--runner")} ${theme.accent("<id>")}  ${theme.dim("Filter to one runner")}`,
      stdout,
    );
    writeLine(
      `  ${theme.dim("$")} ${theme.light("skillgym run")} ${theme.accent("<suite.ts>")} ${theme.light("--case")} ${theme.accent("<id>")}    ${theme.dim("Filter to one case")}`,
      stdout,
    );
    writeLine(`  ${theme.dim("$")} ${theme.light("skillgym help")}                   ${theme.dim("Show CLI help")}`, stdout);
    writeLine("", stdout);
  }
}

function writeLine(value: string, stdout: Pick<NodeJS.WriteStream, "write">): void {
  stdout.write(`${value}\n`);
}
