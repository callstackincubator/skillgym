import process from "node:process";
import { createCliTheme } from "./branding.js";

export function printHelp(): void {
  const theme = createCliTheme(process.stdout);

  console.log(`
${theme.bold("Usage:")} skillgym <command> [options]

${theme.bold("Commands:")}
  run ${theme.accent("<suite.ts>")}    Execute a benchmark suite against the configured runners
  help              Show this help message

${theme.bold("Run Options:")}
  --config ${theme.accent("<path>")}        Load an explicit skillgym config file
  --cwd ${theme.accent("<path>")}           Override the workspace directory for the run
  --output-dir ${theme.accent("<path>")}    Override where run artifacts are written
  --schedule ${theme.accent("<mode>")}      Choose ${theme.light("serial")}, ${theme.light("parallel")}, or ${theme.light("isolated-by-runner")}
  --max-parallel ${theme.accent("<n>")}     Cap concurrent executions for non-serial schedules
  --case ${theme.accent("<id>")}            Filter the configured suite to one case id
  --runner ${theme.accent("<runner-id>")}   Filter the configured runner set by runner id
  --reporter ${theme.accent("<value>")}     Use ${theme.light("standard")} or override run.reporter from config
  --snapshots ${theme.accent("<path>")}     Override the configured snapshot file path
  --update-snapshots       Refresh snapshot baselines for the executed runs

${theme.bold("Examples:")}
  ${theme.dim("$")} ${theme.light("skillgym run ./examples/basic-suite.ts")}
  ${theme.dim("$")} ${theme.light("skillgym run ./examples/basic-suite.ts --runner open-main")}
  ${theme.dim("$")} ${theme.light("skillgym run ./examples/basic-suite.ts --case always-passes")}
  ${theme.dim("$")} ${theme.light("skillgym run ./examples/basic-suite.ts --reporter standard")}
  ${theme.dim("$")} ${theme.light("skillgym run ./examples/basic-suite.ts --schedule isolated-by-runner")}
  ${theme.dim("$")} ${theme.light("skillgym run ./examples/basic-suite.ts --schedule parallel --max-parallel 4")}
  ${theme.dim("$")} ${theme.light("skillgym run ./examples/basic-suite.ts --update-snapshots")}
`);
}
