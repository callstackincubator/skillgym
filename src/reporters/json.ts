import process from "node:process";
import type { BenchmarkReporter } from "./contract.js";

interface JsonReporterOptions {
  stdout?: Pick<NodeJS.WriteStream, "write">;
}

export function createJsonReporter(options: JsonReporterOptions = {}): BenchmarkReporter {
  const stdout = options.stdout ?? process.stdout;

  return {
    onSuiteFinish(event) {
      stdout.write(`${JSON.stringify(event.result, null, 2)}\n`);
    },
  };
}
