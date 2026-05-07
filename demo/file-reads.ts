import { assert, type TestCase } from "../src/index.js";

const suite: TestCase[] = [
  {
    id: "demo-file-reads",
    tags: ["demo", "files"],
    prompt: [
      "Read docs/skill-detection.md and docs/snapshot.md.",
      "Then explain in two bullets how skill detection differs from snapshot checks.",
    ].join(" "),
    async assert(report) {
      assert.fileReads.includes(report, /docs\/skill-detection\.md$/);
      assert.fileReads.includes(report, /docs\/snapshot\.md$/);
      assert.fileReads.before(report, /docs\/skill-detection\.md$/, /docs\/snapshot\.md$/);
      assert.output.includes(report, /skill detection/i);
      assert.output.includes(report, /snapshot/i);
    },
  },
];

export default suite;
