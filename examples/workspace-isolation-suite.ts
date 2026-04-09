import { assert, type SuiteWorkspaceConfig, type TestCase } from "../src/index.js";

export const workspace: SuiteWorkspaceConfig = {
  mode: "isolated",
  templateDir: "./workspace-template",
  bootstrap: {
    command: "sh",
    args: ["./workspace-bootstrap.sh", "demo"],
  },
};

const suite: TestCase[] = [
  {
    id: "isolated-workspace-check",
    prompt: [
      "Inspect the current workspace.",
      "Confirm whether a workspace template and bootstrap command were applied.",
      "Read README.md and bootstrap-output.txt.",
      "Then print exactly these two lines:",
      "Template marker: <value>",
      "Bootstrap marker: <value>",
    ].join(" "),
    async assert(report, ctx) {
      assert.fileReads.includes(report, /README\.md$/);
      assert.fileReads.includes(report, /bootstrap-output\.txt$/);
      assert.match(ctx.finalOutput(), /Template marker:/i);
      assert.match(ctx.finalOutput(), /Bootstrap marker:/i);
    },
  },
];

export default suite;
