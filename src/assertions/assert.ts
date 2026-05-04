import nodeAssert from "node:assert/strict";
import { attachFailureClass, type FailureClassInput } from "../failure-classification.js";
import { commandAssertions } from "./commands.js";
import { fileReadAssertions } from "./file-reads.js";
import { outputAssertions } from "./output.js";
import { skillAssertions } from "./skills.js";
import { softAssert } from "./soft.js";
import { toolCallAssertions } from "./tool-calls.js";
import type { SkillGymAssert } from "./types.js";

export const assert: SkillGymAssert = Object.assign(nodeAssert, {
  classify<T>(failureClass: FailureClassInput, callback: () => T): T {
    try {
      return callback();
    } catch (error) {
      attachFailureClass(error, failureClass);
      throw error;
    }
  },
  soft: softAssert,
  skills: skillAssertions,
  commands: commandAssertions,
  fileReads: fileReadAssertions,
  toolCalls: toolCallAssertions,
  output: outputAssertions,
});
