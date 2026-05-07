import { assert, type TestCase } from "../src/index.js";

const suite: TestCase[] = [
  {
    id: "demo-skill-selection",
    tags: ["demo", "skills"],
    prompt: "Find a skill for upgrading Expo SDK and tell me how to install it.",
    async assert(report) {
      assert.skills.has(report, "find-skills", { minConfidence: "strong" });
      assert.commands.includes(report, "npx skills find");
      assert.output.includes(report, /upgrading-expo/i);
      assert.output.includes(report, /npx skills add/i);
    },
  },
];

export default suite;
