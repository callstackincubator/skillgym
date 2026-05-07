import { assert, commandMatcher, type TestCase } from "../src/index.js";

const suite: TestCase[] = [
  {
    id: "demo-command-matching",
    tags: ["demo", "commands"],
    prompt: [
      "Run exactly one bash command: npx skillgym help.",
      "After the command finishes, answer with one short sentence describing what SkillGym does.",
    ].join(" "),
    async assert(report) {
      assert.commands.first(report, commandMatcher("npx").arg("skillgym").arg("help"));
      assert.commands.first(report, /npx\s+skillgym\s+help/);
      assert.output.includes(report, /benchmark|agent|skill/i);
    },
  },
];

export default suite;
