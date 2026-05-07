import { assert, type TestCase } from "../src/index.js";

const suite: TestCase[] = [
  {
    id: "demo-expected-failure",
    tags: ["demo", "expected-failures"],
    expectedFail: true,
    prompt: "Reply with exactly: skillgym expected failure demo",
    async assert(report) {
      assert.output.includes(report, /this string is intentionally absent/i);
    },
  },
];

export default suite;
