import { assert, type TestCase } from "../src/index.js";

const suite: TestCase[] = [
  {
    id: "command-mismatch-for-explain",
    prompt:
      "Run exactly one bash command: `ls`. After that, briefly say that you listed the current directory.",
    async assert(report) {
      assert.commands.includes(report, "pwd", {
        message: "expected the agent to run `pwd`",
        explain: {
          question:
            "You were asked to run `ls`, but the benchmark expected `pwd` instead. Why did you choose the command you ran?",
        },
      });
    },
  },
];

export default suite;
