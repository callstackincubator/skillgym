import process from "node:process";
import { Command } from "commander";
import { printBanner } from "./cli/branding.js";
import { printHelp } from "./cli/help.js";
import { formatCliError } from "./cli/error.js";
import { explainCommand } from "./cli/explain.js";
import { ExecutionFailuresError, runCommand } from "./cli/run.js";
import { listBundledSkills, readBundledSkill } from "./cli/skills.js";
import { accumulateTagOptionValues, parseTagOption } from "./cli/tag-options.js";

function printMotdHelp(): void {
  printBanner({ kind: "full" });
  printHelp();
}

function shouldPrintMotdHelp(argv: string[]): boolean {
  if (argv.length === 0) {
    return true;
  }
  const head = argv[0];
  if (head === "help") {
    return true;
  }
  if (argv.length === 1 && (head === "--help" || head === "-h")) {
    return true;
  }
  return false;
}

function createProgram(): Command {
  const program = new Command();
  program.name("skillgym");
  program.helpOption(false);
  program.helpCommand(false);

  const runCmd = program
    .command("run")
    .description("Execute a benchmark suite against the configured runners")
    .helpOption("-h, --help", "Display help for command")
    .argument("<suite>", "Path to the benchmark suite TypeScript file")
    .option("--config <path>", "Load an explicit skillgym config file")
    .option("--cwd <path>", "Override the workspace directory for the execution")
    .option("--output-dir <path>", "Override where execution artifacts are written")
    .option("--schedule <mode>", "Choose serial, parallel, or isolated-by-runner")
    .option("--max-parallel <n>", "Cap concurrent executions for non-serial schedules")
    .option("--repeat <n>", "Require n successful repetitions per case x runner")
    .option(
      "--repeat-failure <n>",
      "Retry the current repetition up to n extra times after failure",
    )
    .option("--retry-failed <n>", "Deprecated alias for --repeat-failure")
    .option("--case <id>", "Filter the configured suite to one case id")
    .option(
      "--tag <tag>",
      "Filter cases by tag; repeat or comma-separate for OR matching",
      accumulateTagOptionValues,
      [],
    )
    .option("--runner <runner-id>", "Filter the configured runner set by runner id")
    .option(
      "--reporter <value>",
      "Use standard, json, json-summary, token-usage, github-actions, html, or override run.reporter",
    )
    .option("--snapshots <path>", "Override the configured snapshot file path")
    .option("--update-snapshots", "Refresh snapshot baselines for the selected executions");

  runCmd.action(async (suite: string) => {
    const opts = runCmd.opts<{
      config?: string;
      cwd?: string;
      outputDir?: string;
      schedule?: string;
      maxParallel?: string;
      repeat?: string;
      repeatFailure?: string;
      retryFailed?: string;
      case?: string;
      tag?: string[];
      runner?: string;
      reporter?: string;
      snapshots?: string;
      updateSnapshots?: boolean;
    }>();

    await runCommand({
      suitePath: suite,
      cwd: opts.cwd,
      outputDir: opts.outputDir,
      caseId: opts.case,
      runner: opts.runner,
      reporter: opts.reporter,
      schedule: opts.schedule,
      maxParallel: opts.maxParallel,
      repeat: opts.repeat,
      repeatFailure: opts.repeatFailure,
      retryFailed: opts.retryFailed,
      tags: parseTagOption(opts.tag),
      reporterCwd: process.cwd(),
      configPath: opts.config,
      updateSnapshots: opts.updateSnapshots === true,
      snapshotsPath: opts.snapshots,
    });
  });

  const explainCmd = program
    .command("explain")
    .description("Explain a failed execution from the exact failed artifact directory")
    .helpOption("-h, --help", "Display help for command")
    .argument("<artifactDir>", "Failed execution artifact directory")
    .option("--rerun", "Re-run explain and overwrite an existing explanations.json artifact");

  explainCmd.action(async (artifactDir: string) => {
    const opts = explainCmd.opts<{ rerun?: boolean }>();
    await explainCommand({ artifactDir, rerun: opts.rerun === true });
  });

  const skillsCmd = program
    .command("skills")
    .description("Inspect bundled skill files")
    .helpOption("-h, --help", "Display help for command")
    .helpCommand(false);

  skillsCmd
    .command("list")
    .description("List bundled skill files")
    .helpOption("-h, --help", "Display help for command")
    .action(() => {
      console.log(listBundledSkills().join("\n"));
    });

  skillsCmd
    .command("get <name>")
    .description("Print one bundled skill file")
    .helpOption("-h, --help", "Display help for command")
    .action((name: string) => {
      console.log(readBundledSkill(name));
    });

  return program;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (shouldPrintMotdHelp(argv)) {
    printMotdHelp();
    return;
  }

  const program = createProgram();
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  if (error instanceof ExecutionFailuresError) {
    process.exitCode = 1;
    return;
  }

  console.error(formatCliError(error));
  process.exitCode = 1;
});
