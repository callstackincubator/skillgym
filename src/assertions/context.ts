import type { AssertionContext } from "../domain/test-case.js";
import type { SessionEvent, SessionReport } from "../domain/session-report.js";

export function createAssertionContext(report: SessionReport): AssertionContext {
  return {
    getCommands() {
      return report.events
        .filter(
          (event): event is Extract<SessionEvent, { type: "command" }> => event.type === "command",
        )
        .map((event) => event.command);
    },
    getToolCalls(tool?: string) {
      return report.events.filter((event) => {
        if (event.type !== "toolCall") {
          return false;
        }

        return tool === undefined ? true : event.tool === tool;
      });
    },
    getFileReads() {
      return report.files.observedReads;
    },
    detectedSkills() {
      return report.detectedSkills;
    },
    finalOutput() {
      return report.finalOutput;
    },
  };
}
