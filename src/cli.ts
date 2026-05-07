import { printHelp } from "./cli/help.js";
import { printBanner } from "./cli/branding.js";
import { formatCliError } from "./cli/error.js";
import { RunFailuresError, runCommand } from "./cli/run.js";
import { listBundledSkills, readBundledSkill } from "./cli/skills.js";
import { parseArgs } from "./utils/cli.js";

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  switch (parsed.command) {
    case "run": {
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
      const maxParallelOption = parsed.options["max-parallel"];
      const repeatOption = parsed.options.repeat;
      const repeatFailureOption = parsed.options["repeat-failure"];
      const retryFailedOption = parsed.options["retry-failed"];
      const updateSnapshotsOption = parsed.options["update-snapshots"];
      const snapshotsOption = parsed.options.snapshots;
      const tagOption = parsed.options.tag;

      await runCommand({
        suitePath,
        cwd: getStringOption(cwdOption),
        outputDir: getStringOption(outputDirOption),
        caseId: getStringOption(caseOption),
        runner: getStringOption(runnerOption),
        reporter: getStringOption(reporterOption),
        schedule: getStringOption(scheduleOption),
        maxParallel: getStringOption(maxParallelOption),
        repeat: getStringOption(repeatOption),
        repeatFailure: getStringOption(repeatFailureOption),
        retryFailed: getStringOption(retryFailedOption),
        tags: parseTagOption(tagOption),
        reporterCwd: process.cwd(),
        configPath: getStringOption(configOption),
        updateSnapshots: updateSnapshotsOption === true,
        snapshotsPath: getStringOption(snapshotsOption),
      });
      return;
    }
    case "help":
      printBanner({ kind: "full" });
      printHelp();
      return;
    case "skills": {
      const subcommand = parsed.positionals[0] ?? "list";

      if (subcommand === "list") {
        console.log(listBundledSkills().join("\n"));
        return;
      }

      if (subcommand === "get") {
        const skillName = parsed.positionals[1];
        if (skillName === undefined) {
          throw new Error("Missing skill name. Usage: skillgym skills get <name>");
        }

        console.log(readBundledSkill(skillName));
        return;
      }

      throw new Error(`Unknown skills subcommand: ${subcommand}`);
    }
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

function parseTagOption(value: string | boolean | string[] | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    throw new Error("CLI option --tag requires a non-empty value.");
  }

  const values = Array.isArray(value) ? value : [value];
  const tags = values.flatMap((item) => item.split(",").map((tag) => tag.trim()));

  if (tags.some((tag) => tag.length === 0)) {
    throw new Error("CLI option --tag requires non-empty comma-separated values.");
  }

  return [...new Set(tags)];
}

function getStringOption(value: string | boolean | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value.at(-1);
  }

  return typeof value === "string" ? value : undefined;
}
