import { assert, type TestCase } from "../src/index.ts";

const suite: TestCase[] = [
  {
    id: "basic-help",
    prompt: "Print help for the current workspace tool and summarize what it does.",
    async assert(report, ctx) {
      assert.ok(ctx.finalOutput().length > 0, "Expected non-empty final output");
    },
  },
  {
    id: "basic-ready",
    prompt: "Say only: skillgym ready",
    async assert(report, ctx) {
      assert.match(ctx.finalOutput(), /skillgym ready/);
    },
  },
];

export default suite;
