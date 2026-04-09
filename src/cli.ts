import { printHelp } from "./cli/help.js";
import { printBanner } from "./cli/branding.js";
import { formatCliError } from "./cli/error.js";
import { RunFailuresError, runCommand } from "./cli/run.js";
import { parseArgs } from "./utils/cli.js";

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  switch (parsed.command) {
    case "run": {
      printBanner({ kind: "compact" });
      const suitePath = parsed.positionals[0];
      if (suitePath === undefined) {
        throw new Error("Missing suite path. Usage: skillgym run <suite.ts>");
      }

      const cwdOption = parsed.options.cwd;
      const outputDirOption = parsed.options["output-dir"];
      const caseOption = parsed.options.case;
      const runnerOption = parsed.options.runner;
      const reporterOption = parsed.options.reporter;
      const scheduleOption = parsed.options.schedule;
      const configOption = parsed.options.config;
      const updateSnapshotsOption = parsed.options["update-snapshots"];
      const snapshotsOption = parsed.options.snapshots;

      await runCommand({
        suitePath,
        cwd: typeof cwdOption === "string" ? cwdOption : undefined,
        outputDir: typeof outputDirOption === "string" ? outputDirOption : undefined,
        caseId: typeof caseOption === "string" ? caseOption : undefined,
        runner: typeof runnerOption === "string" ? runnerOption : undefined,
        reporter: typeof reporterOption === "string" ? reporterOption : undefined,
        schedule: typeof scheduleOption === "string" ? scheduleOption : undefined,
        reporterCwd: process.cwd(),
        configPath: typeof configOption === "string" ? configOption : undefined,
        updateSnapshots: updateSnapshotsOption === true,
        snapshotsPath: typeof snapshotsOption === "string" ? snapshotsOption : undefined,
      });
      return;
    }
    case "help":
      printBanner({ kind: "full" });
      printHelp();
      return;
    default:
      printBanner({ kind: "full" });
      printHelp();
  }
}

main().catch((error: unknown) => {
  if (error instanceof RunFailuresError) {
    process.exitCode = 1;
    return;
  }

  console.error(formatCliError(error));
  process.exitCode = 1;
});
