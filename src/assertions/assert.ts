import nodeAssert from "node:assert/strict";
import { commandAssertions } from "./commands.ts";
import { fileReadAssertions } from "./file-reads.ts";
import { outputAssertions } from "./output.ts";
import { skillAssertions } from "./skills.ts";
import { toolCallAssertions } from "./tool-calls.ts";
import type { SkillGymAssert } from "./types.ts";

export const assert: SkillGymAssert = Object.assign(nodeAssert, {
  skills: skillAssertions,
  commands: commandAssertions,
  fileReads: fileReadAssertions,
  toolCalls: toolCallAssertions,
  output: outputAssertions,
});
