import { assert, type TestCase } from "../src/index.js";

const suite: TestCase[] = [
  {
    id: "demo-failure-classification",
    tags: ["demo", "failure-classification"],
    prompt: "Reply with exactly: I will use cursr agent for this task.",
    classifyFailure(result) {
      return result.error?.message.includes("wrong Cursor CLI alias")
        ? { id: "wrong-cli-alias", label: "Wrong CLI alias" }
        : undefined;
    },
    async assert(_report, ctx) {
      assert.classify({ id: "wrong-cli-alias", label: "Wrong CLI alias" }, () => {
        assert.doesNotMatch(
          ctx.finalOutput(),
          /\bcursr\b/i,
          "wrong Cursor CLI alias in final output",
        );
      });
    },
  },
];

export default suite;
