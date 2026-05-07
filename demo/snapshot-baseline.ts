import { assert, type TestCase } from "../src/index.js";

const suite: TestCase[] = [
  {
    id: "demo-snapshot-baseline",
    tags: ["demo", "snapshots"],
    prompt: "Reply with exactly: skillgym snapshot baseline ready",
    async assert(report, ctx) {
      assert.output.notEmpty(report);
      assert.match(ctx.finalOutput(), /^skillgym snapshot baseline ready$/i);
    },
  },
];

export default suite;
