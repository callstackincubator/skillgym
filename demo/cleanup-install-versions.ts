import { assert, type SuiteWorkspaceConfig, type TestCase } from "../src/index.js";

export const workspace: SuiteWorkspaceConfig = {
  mode: "isolated",
  templateDir: "./cleanup-install-versions-template",
};

const suite: TestCase[] = [
  {
    id: "cleanup-install-versions",
    tags: ["demo", "workspace", "versions", "baseline-2026.05.05-84a231c"],
    prompt: [
      "This workspace is a tiny monorepo template.",
      "Read every package.json under the workspace.",
      'Edit them so that every engines.node is ">=22.18.0" and only the root package.json declares packageManager (remove packageManager from nested packages).',
      "Then reply with exactly: cleanup-install-versions 2026.05.05-84a231c",
    ].join(" "),
    async assert(report, ctx) {
      assert.fileReads.atLeast(report, /package\.json$/, 2);
      assert.match(ctx.finalOutput(), /^cleanup-install-versions 2026\.05\.05-84a231c$/i);
    },
  },
];

export default suite;
