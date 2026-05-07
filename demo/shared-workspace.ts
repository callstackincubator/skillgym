import { assert, type SuiteWorkspaceConfig, type TestCase } from "../src/index.js";

export const workspace: SuiteWorkspaceConfig = {
  mode: "shared",
  cwd: "..",
};

const suite: TestCase[] = [
  {
    id: "demo-shared-workspace",
    tags: ["demo", "workspace", "shared"],
    prompt: [
      "Inspect the repository root workspace.",
      "Read README.md and identify the project name and what it does.",
      "Reply in one sentence.",
    ].join(" "),
    async assert(report) {
      assert.fileReads.includes(report, /README\.md$/);
      assert.output.includes(report, /skillgym/i);
      assert.output.includes(report, /benchmark/i);
    },
  },
];

export default suite;
