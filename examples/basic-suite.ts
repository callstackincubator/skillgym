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
  // Requires maxSteps: 1 in skillgym.config.js to reproduce the failure.
  {
    id: "max-steps-exceeded",
    prompt: "Run `echo step1`, `echo step2`, `echo step3`, `echo step4`, `echo step5` as five separate bash commands, then say: all steps done",
    async assert(_report, ctx) {
      assert.match(ctx.finalOutput(), /all steps done/i);
    },
  },
];

export default suite;
