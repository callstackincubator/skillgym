import { assert, type TestCase } from "../src/index.js";

const suite: TestCase[] = [
  {
    id: "demo-soft-assertions",
    tags: ["demo", "assertions"],
    prompt: "Reply with exactly: skillgym soft assertions demo",
    async assert(report, ctx) {
      assert.soft.output.includes(report, /this phrase should not appear/i);
      assert.soft.match(ctx.finalOutput(), /this regex should never match/i);
      assert.soft.output.includes(report, /another missing phrase/i);
    },
  },
];

export default suite;
