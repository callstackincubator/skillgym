import { assert, type TestCase } from "skillgym";

const suite: TestCase[] = [
  {
    id: "wrong-cli-alias-echo",
    prompt: [
      "Reply with exactly: I will use cursr agent for this task.",
      "Do not mention the correct CLI alias.",
    ].join(" "),
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
  {
    id: "wrong-cli-alias-command",
    prompt: [
      'Say you would run this command: cursr agent "open README.md".',
      "Do not correct the alias.",
    ].join(" "),
    classifyFailure(result) {
      return result.error?.message.includes("wrong Cursor CLI alias")
        ? { id: "wrong-cli-alias", label: "Wrong CLI alias" }
        : undefined;
    },
    async assert(_report, ctx) {
      assert.classify({ id: "wrong-cli-alias", label: "Wrong CLI alias" }, () => {
        assert.doesNotMatch(
          ctx.finalOutput(),
          /\bcursr\s+agent\b/i,
          "wrong Cursor CLI alias in final output",
        );
      });
    },
  },
];

export default suite;
