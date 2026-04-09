import { assert, type TestCase } from "../src/index.js";

const prompt = "Find a skill for upgrading Expo SDK and tell me how to install it.";

const suite: TestCase[] = [
  {
    id: "find-skills-expo-opencode-compatible",
    prompt,
    async assert(report) {
      assert.skills.has(report, "find-skills");
      assert.commands.includes(report, "npx skills find");
      assert.match(report.finalOutput, /upgrading-expo/i);
      assert.match(report.finalOutput, /npx skills add/i);
    },
  },
  {
    id: "find-skills-expo-strict",
    prompt,
    async assert(report) {
      assert.skills.includes(report, ["find-skills", "upgrading-expo"]);
      assert.fileReads.includes(report, /find-skills\/SKILL\.md$/);
      assert.fileReads.includes(report, /upgrading-expo\/SKILL\.md$/);
      assert.fileReads.before(report, /find-skills\/SKILL\.md$/, /upgrading-expo\/SKILL\.md$/);
      assert.match(report.finalOutput, /upgrading-expo/i);
      assert.match(report.finalOutput, /npx skills add/i);
    },
  },
];

export default suite;
