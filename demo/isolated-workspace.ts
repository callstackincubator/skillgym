import { assert, type SuiteWorkspaceConfig, type TestCase } from "../src/index.js";

export const workspace: SuiteWorkspaceConfig = {
  mode: "isolated",
  templateDir: "./isolated-workspace-template",
  bootstrap: {
    command: "sh",
    args: ["./workspace-bootstrap.sh", "demo-bootstrap"],
  },
};

const suite: TestCase[] = [
  {
    id: "demo-isolated-workspace",
    tags: ["demo", "workspace", "isolated"],
    prompt: [
      "Inspect the current isolated workspace.",
      "Create whoami.md and describe who are you.",
      "If whoami.md already exists, say 'ERROR'.",
      "Read README.md, whoami.md, and bootstrap-output.txt.",
      "Then print exactly these three lines:",
      "Template marker: <value>",
      "Bootstrap marker: <value>",
    ].join(" "),
    async assert(report, ctx) {
      assert.fileReads.includes(report, /README\.md$/);
      assert.fileReads.includes(report, /bootstrap-output\.txt$/);
      assert.match(ctx.finalOutput(), /Template marker: demo-template/i);
      assert.match(ctx.finalOutput(), /Bootstrap marker: demo-bootstrap/i);
    },
  },
];

export default suite;
