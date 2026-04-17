import { describe, expect, test } from "vitest";
import { createMaxStepsMonitor } from "../../src/limits/max-steps.js";

describe("max steps monitor", () => {
  test("counts codex steps on completed agent messages", () => {
    const monitor = createMaxStepsMonitor({ agentType: "codex", runnerId: "code-main", maxSteps: 1 });

    expect(monitor.observeLine('{"type":"item.completed","item":{"id":"item_1","type":"agent_message"}}')).toBeUndefined();
    expect(monitor.observeLine('{"type":"item.completed","item":{"id":"item_1","type":"agent_message"}}')).toBeUndefined();
    expect(monitor.observeLine('{"type":"item.completed","item":{"id":"item_2","type":"agent_message"}}')).toMatchObject({ observedSteps: 2, maxSteps: 1 });
  });

  test("counts opencode steps on step_finish", () => {
    const monitor = createMaxStepsMonitor({ agentType: "opencode", runnerId: "open-main", maxSteps: 1 });

    expect(monitor.observeLine('{"type":"step_start"}')).toBeUndefined();
    expect(monitor.observeLine('{"type":"step_finish"}')).toBeUndefined();
    expect(monitor.observeLine('{"type":"step_finish"}')).toMatchObject({ observedSteps: 2 });
  });

  test("deduplicates claude assistant messages by id", () => {
    const monitor = createMaxStepsMonitor({ agentType: "claude-code", runnerId: "claude-main", maxSteps: 1 });

    expect(monitor.observeLine('{"type":"assistant","message":{"id":"msg_1"}}')).toBeUndefined();
    expect(monitor.observeLine('{"type":"assistant","message":{"id":"msg_1"}}')).toBeUndefined();
    expect(monitor.observeLine('{"type":"assistant","message":{"id":"msg_2"}}')).toMatchObject({ observedSteps: 2 });
  });

  test("counts cursor tool rounds and final assistant rounds", () => {
    const monitor = createMaxStepsMonitor({ agentType: "cursor-agent", runnerId: "cursor-main", maxSteps: 1 });

    expect(monitor.observeLine('{"type":"tool_call","subtype":"started","model_call_id":"call-1"}')).toBeUndefined();
    expect(monitor.observeLine('{"type":"tool_call","subtype":"completed","model_call_id":"call-1"}')).toBeUndefined();
    expect(monitor.observeLine('{"type":"assistant","message":{"role":"assistant"}}')).toMatchObject({ observedSteps: 2 });
  });
});
