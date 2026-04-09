import { assert, type TestCase } from "../src/index.js";

const suite: TestCase[] = [
  {
    id: "always-passes",
    prompt: "Say only: skillgym ready",
    async assert(_report, ctx) {
      assert.match(ctx.finalOutput(), /skillgym ready/);
    },
  },
  {
    id: "assertion-fails",
    prompt: "Say only: skillgym ready",
    async assert(_report, ctx) {
      assert.match(ctx.finalOutput(), /this will never match/);
    },
  },
  {
    id: "assert-crashes",
    prompt: "Say only: skillgym ready",
    async assert() {
      throw new Error("assert hook crashed intentionally");
    },
  },
];

export default suite;
