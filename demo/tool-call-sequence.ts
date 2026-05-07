import { assert, type TestCase } from "../src/index.js";

const suite: TestCase[] = [
  {
    id: "demo-tool-call-sequence",
    tags: ["demo", "tools"],
    prompt: [
      "First read docs/readme.md.",
      "Then run exactly one bash command: npx skillgym skills list.",
      "Finally mention the core skill name that appears in the list.",
    ].join(" "),
    async assert(report) {
      assert.toolCalls.sequence(report, [
        {
          tool: "read",
          where: (args) => /docs\/readme\.md$/.test((args as { filePath?: string }).filePath ?? ""),
        },
        {
          tool: "bash",
          where: (args) =>
            /npx\s+skillgym\s+skills\s+list/.test((args as { command?: string }).command ?? ""),
        },
      ]);
      assert.output.includes(report, /core/i);
    },
  },
];

export default suite;
