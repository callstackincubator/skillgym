import { assert, type TestCase } from "../src/index.js";

const suite: TestCase[] = [
  {
    id: "demo-cross-runner",
    tags: ["demo", "runners"],
    prompt: "Reply with exactly: skillgym cross runner check",
    async assert(report, ctx) {
      assert.output.notEmpty(report);
      assert.match(ctx.finalOutput(), /^skillgym cross runner check$/i);
    },
  },
];

export default suite;
