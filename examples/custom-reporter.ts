import type { BenchmarkReporter } from "../src/index.js";

const reporter: BenchmarkReporter = {
  onSuiteStart(event) {
    console.log(`Running ${event.context.suitePath}`);
  },
  onSuiteFinish(event) {
    console.log(`Output dir: ${event.result.outputDir}`);
  },
};

export default reporter;
