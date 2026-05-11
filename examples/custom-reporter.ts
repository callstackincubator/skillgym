import type { BenchmarkReporter } from "../src/index.js";

const reporter: BenchmarkReporter = {
  onSuiteStart(event) {
    console.log(`Running ${event.context.suitePath}`);
  },
  onSuiteFinish(event) {
    console.log(`Suite-run artifact directory: ${event.result.suiteRunArtifactDir}`);
  },
};

export default reporter;
