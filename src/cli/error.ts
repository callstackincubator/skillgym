import pc from "picocolors";

interface CliErrorPresentation {
  title: string;
  detail: string;
  fixes: string[];
}

interface CliErrorRule {
  id: string;
  matches(message: string): boolean;
  present(message: string): CliErrorPresentation;
}

export function formatCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const presentation = classifyCliError(message);
  const lines = [
    pc.red(pc.bold(`Error: ${presentation.title}`)),
    "",
    presentation.detail,
  ];

  if (presentation.fixes.length > 0) {
    lines.push("", pc.bold("Try:"));
    for (const fix of presentation.fixes) {
      lines.push(`- ${fix}`);
    }
  }

  return lines.join("\n");
}

function classifyCliError(message: string): CliErrorPresentation {
  const rule = cliErrorRules.find((candidate) => candidate.matches(message));
  return rule?.present(message) ?? defaultCliErrorPresentation(message);
}

// Keep user-facing translations declarative so new internal errors can be mapped
// by adding one small rule instead of extending formatting control flow.
const cliErrorRules: CliErrorRule[] = [
  exactRule("missing-suite-path", "Missing suite path. Usage: skillgym run <suite.ts>", () => ({
    title: "missing suite path",
    detail: "`skillgym run` needs a suite file to execute.",
    fixes: [
      "Pass a suite path, for example `skillgym run ./examples/basic-suite.ts`.",
      "Run `skillgym help` to see the available flags.",
    ],
  })),
  exactRule("missing-config", "No skillgym config found. Create skillgym.config.ts with a non-empty runners map.", () => ({
    title: "missing configuration",
    detail: "skillgym could not find a `skillgym.config.*` file with at least one configured runner.",
    fixes: [
      "Create `skillgym.config.ts`, `skillgym.config.mjs`, or another supported config file next to your suite or in a parent directory.",
      "Define at least one runner under `runners`, for example `{ runners: { open: { agent: { type: 'opencode' } } } }`.",
      "Use `--config <path>` if your config lives somewhere else.",
    ],
  })),
  prefixRule("multiple-config-files", "Multiple config files found in ", (message) => ({
    title: "multiple config files found",
    detail: message,
    fixes: [
      "Keep only one `skillgym.config.*` file in that directory.",
      "Or pass the intended file explicitly with `--config <path>`.",
    ],
  })),
  prefixRule("unknown-config-key", "Unknown config key: ", (message) => ({
    title: "config contains an unknown key",
    detail: message,
    fixes: [
      "Check the config key for a typo.",
      "Compare the file against the documented `run`, `defaults`, and `runners` shape.",
    ],
  })),
  oneOfPrefixRule("invalid-config", ["Invalid config at ", "Invalid config:"], (message) => ({
    title: "config is invalid",
    detail: message,
    fixes: [
      "Update the config value to match the expected type shown in the error.",
      "Use the README config example as a reference for valid runner settings.",
    ],
  })),
  prefixRule("invalid-suite-export", "Suite file does not have a default export: ", () => ({
    title: "suite file is not loadable",
    detail: "The suite module loaded, but it does not export a default suite.",
    fixes: [
      "Export your cases as the default export, for example `export default [ ...cases ]`.",
      "Make sure the path passed to `skillgym run` points to the intended suite file.",
    ],
  })),
  prefixRule("reporter-load-failed", "Failed to load reporter module: ", (message) => ({
    title: "custom reporter could not be loaded",
    detail: message,
    fixes: [
      "Check that the reporter path is correct and resolves from the current working directory or config directory.",
      "Make sure the reporter file can be imported by Node and does not throw during startup.",
    ],
  })),
  prefixRule("invalid-reporter-export", "Reporter module must export ", (message) => ({
    title: "custom reporter export is invalid",
    detail: message,
    fixes: [
      "Export an object as the default export or named `reporter` export.",
      "Implement at least one reporter hook such as `onSuiteStart` or `onSuiteFinish`.",
    ],
  })),
  exactRule("no-runners-configured", "No runners configured.", () => ({
    title: "no runners are configured",
    detail: "skillgym found your config file, but `runners` resolved to an empty selection.",
    fixes: [
      "Add at least one runner under `runners` in `skillgym.config.*`.",
      "Check that your selected config file is the one you intended to use.",
    ],
  })),
  prefixRule("runner-filter-miss", "No runners matched the requested filter: ", (message) => {
    const runnerId = message.slice("No runners matched the requested filter: ".length);
    return {
      title: "runner filter did not match anything",
      detail: `No configured runner matches \`${runnerId}\`.`,
      fixes: [
        "Check the runner id in `skillgym.config.*`.",
        "Remove `--runner` to run all configured runners.",
      ],
    };
  }),
  exactRule("case-filter-miss", "No test cases matched the requested filters.", () => ({
    title: "case filter did not match anything",
    detail: "The selected suite does not contain a case matching the provided filters.",
    fixes: [
      "Check the case id passed to `--case`.",
      "Remove `--case` to run the full suite.",
    ],
  })),
  prefixRule("runner-command-failed", "Command failed: ", (message) => ({
    title: "runner command failed",
    detail: message,
    fixes: [
      "Make sure the target CLI is installed and available on PATH.",
      "Check your runner command, args, and environment variables in `skillgym.config.*`.",
      "Inspect the saved `stdout.log` and `stderr.log` artifacts for the underlying tool output.",
    ],
  })),
  exactRule("opencode-missing-session-id", "OpenCode run did not emit a session id; cannot export structured session data.", () => ({
    title: "OpenCode did not produce a session id",
    detail: "skillgym could not correlate the run with an exported OpenCode session.",
    fixes: [
      "Make sure the installed `opencode` CLI supports both `run --format json` and `export`.",
      "Re-run the command and inspect the saved stdout/stderr artifacts to see what OpenCode actually emitted.",
    ],
  })),
  prefixRule("opencode-invalid-export-json", "OpenCode export returned invalid JSON:", (message) => ({
    title: "OpenCode export returned unreadable data",
    detail: message,
    fixes: [
      "Check whether the installed `opencode` version changed its export format.",
      "Inspect `session.export.json` or the export command artifacts to confirm what was returned.",
    ],
  })),
  oneOfExactRule(
    "opencode-missing-export-data",
    [
      "OpenCode export was missing required session fields.",
      "OpenCode artifacts did not include a structured export session.",
    ],
    (message) => ({
      title: "OpenCode export is missing required data",
      detail: message,
      fixes: [
        "Confirm that `opencode export <session-id>` returns a structured session payload on your version.",
        "Inspect the saved export artifact to see which fields are missing.",
      ],
    }),
  ),
];

function exactRule(
  id: string,
  exactMessage: string,
  present: (message: string) => CliErrorPresentation,
): CliErrorRule {
  return {
    id,
    matches(message) {
      return message === exactMessage;
    },
    present,
  };
}

function oneOfExactRule(
  id: string,
  exactMessages: string[],
  present: (message: string) => CliErrorPresentation,
): CliErrorRule {
  return {
    id,
    matches(message) {
      return exactMessages.includes(message);
    },
    present,
  };
}

function prefixRule(
  id: string,
  prefix: string,
  present: (message: string) => CliErrorPresentation,
): CliErrorRule {
  return {
    id,
    matches(message) {
      return message.startsWith(prefix);
    },
    present,
  };
}

function oneOfPrefixRule(
  id: string,
  prefixes: string[],
  present: (message: string) => CliErrorPresentation,
): CliErrorRule {
  return {
    id,
    matches(message) {
      return prefixes.some((prefix) => message.startsWith(prefix));
    },
    present,
  };
}

function defaultCliErrorPresentation(message: string): CliErrorPresentation {
  return {
    title: "skillgym could not complete the run",
    detail: message,
    fixes: [
      "Re-run the command with the same inputs and inspect the generated artifacts if any were written.",
      "If this looks like a bug in skillgym, keep the error text and failing command for debugging.",
    ],
  };
}
