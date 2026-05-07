import { assert, type TestCase } from "../src/index.js";

const suite: TestCase[] = [
  {
    id: "demo-basic-output",
    tags: ["demo", "core", "output"],
    prompt: "Reply with exactly: skillgym demo ready",
    async assert(report, ctx) {
      assert.output.notEmpty(report);
      assert.match(ctx.finalOutput(), /^skillgym demo ready$/i);
    },
  },
];

export default suite;
