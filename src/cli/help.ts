import process from "node:process";
import { createCliTheme } from "./branding.js";

export function printHelp(): void {
  const theme = createCliTheme(process.stdout);

  console.log(`
${theme.bold("Usage:")} skillgym <command> [options]

If you are an LLM agent, run ${theme.light("skillgym skills get core")} before authoring or debugging a benchmark suite.

${theme.bold("Commands:")}
  run ${theme.accent("<suite.ts>")}     Execute a benchmark suite against the configured runners
  explain ${theme.accent("<artifactDir>")} Explain a failed execution from the exact failed artifact directory
  skills list        List bundled skill files
  skills get ${theme.accent("<name>")}  Print one bundled skill file
  help               Show this help message

${theme.bold("Explain Options:")}
  --rerun             Re-run explain and overwrite an existing ${theme.light("explanations.json")} artifact

${theme.bold("Run Options:")}
  --config ${theme.accent("<path>")}        Load an explicit skillgym config file
  --cwd ${theme.accent("<path>")}           Override the workspace directory for the execution
  --output-dir ${theme.accent("<path>")}    Override where execution artifacts are written
  --schedule ${theme.accent("<mode>")}      Choose ${theme.light("serial")}, ${theme.light("parallel")}, or ${theme.light("isolated-by-runner")}
  --max-parallel ${theme.accent("<n>")}     Cap concurrent executions for non-serial schedules
  --repeat ${theme.accent("<n>")}           Require ${theme.light("n")} successful repetitions per case x runner
  --repeat-failure ${theme.accent("<n>")}   Retry the current repetition up to ${theme.light("n")} extra times after failure
  --retry-failed ${theme.accent("<n>")}     Deprecated alias for ${theme.light("--repeat-failure")}
  --case ${theme.accent("<id>")}            Filter the configured suite to one case id
  --tag ${theme.accent("<tag>")}            Filter cases by tag; repeat or comma-separate for OR matching
  --runner ${theme.accent("<runner-id>")}   Filter the configured runner set by runner id
  --reporter ${theme.accent("<value>")}     Use ${theme.light("standard")}, ${theme.light("json")}, ${theme.light("json-summary")}, ${theme.light("token-usage")}, ${theme.light("github-actions")}, ${theme.light("html")}, or override run.reporter
  --snapshots ${theme.accent("<path>")}     Override the configured snapshot file path
  --update-snapshots       Refresh snapshot baselines for the selected executions

${theme.bold("Examples:")}
  ${theme.dim("$")} ${theme.light("skillgym skills get core")}
  ${theme.dim("$")} ${theme.light("skillgym run ./examples/basic-suite.ts")}
  ${theme.dim("$")} ${theme.light("skillgym run ./examples/basic-suite.ts --runner open-main")}
  ${theme.dim("$")} ${theme.light("skillgym run ./examples/basic-suite.ts --case always-passes")}
  ${theme.dim("$")} ${theme.light("skillgym run ./examples/basic-suite.ts --tag smoke")}
  ${theme.dim("$")} ${theme.light("skillgym run ./examples/basic-suite.ts --reporter standard")}
  ${theme.dim("$")} ${theme.light("skillgym run ./examples/basic-suite.ts --schedule isolated-by-runner")}
  ${theme.dim("$")} ${theme.light("skillgym run ./examples/basic-suite.ts --schedule parallel --max-parallel 4")}
  ${theme.dim("$")} ${theme.light("skillgym run ./examples/basic-suite.ts --repeat 5 --repeat-failure 2")}
  ${theme.dim("$")} ${theme.light("skillgym run ./examples/basic-suite.ts --update-snapshots")}
  ${theme.dim("$")} ${theme.light("skillgym explain ./.skillgym-results/run-1/case-a/open-main/repeat-1")}
  ${theme.dim("$")} ${theme.light("skillgym explain ./.skillgym-results/run-1/case-a/open-main/repeat-1 --rerun")}
`);
}
