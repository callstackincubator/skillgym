import { AssertionError } from "node:assert/strict";
import { beforeEach, expect, test, vi } from "vitest";
import type { JudgeVerdict } from "../../src/domain/judge.js";

const mockState = vi.hoisted(() => ({
  getAdapterCalls: [] as Array<{ type: string; model: string }>,
  judgeCalls: [] as Array<{ model: string; prompt: string; timeoutMs: number }>,
  verdict: {
    verdict: "pass",
    score: 0.9,
    reason: "meets rubric",
  } as JudgeVerdict,
  judgeError: undefined as Error | undefined,
}));

vi.mock("../../src/adapters/index.js", () => ({
  getAdapter(config: { type: string; model: string }) {
    mockState.getAdapterCalls.push(config);

    return {
      async judge(input: { model: string; prompt: string; timeoutMs: number }) {
        mockState.judgeCalls.push(input);

        if (mockState.judgeError !== undefined) {
          throw mockState.judgeError;
        }

        return mockState.verdict;
      },
    };
  },
}));

import { assert } from "../../src/index.js";

beforeEach(() => {
  mockState.getAdapterCalls.splice(0);
  mockState.judgeCalls.splice(0);
  mockState.verdict = {
    verdict: "pass",
    score: 0.9,
    reason: "meets rubric",
  };
  mockState.judgeError = undefined;
});

test("assert.judge passes agent and model through and returns score plus reason", async () => {
  mockState.verdict = {
    verdict: "pass",
    score: 0.87,
    reason: "covers required steps",
  };

  await expect(
    assert.judge({
      agent: "copilot",
      model: "judge-model",
      rubric: "Must cover required steps.",
      input: "Session report excerpt.",
    }),
  ).resolves.toEqual({
    score: 0.87,
    reason: "covers required steps",
  });

  expect(mockState.getAdapterCalls).toEqual([{ type: "copilot", model: "judge-model" }]);
  expect(mockState.judgeCalls).toHaveLength(1);
  expect(mockState.judgeCalls[0]).toMatchObject({
    model: "judge-model",
    timeoutMs: 120_000,
  });
  expect(mockState.judgeCalls[0]?.prompt).toContain("<<<RUBRIC>>>");
  expect(mockState.judgeCalls[0]?.prompt).toContain("Must cover required steps.");
  expect(mockState.judgeCalls[0]?.prompt).toContain("<<<INPUT>>>");
  expect(mockState.judgeCalls[0]?.prompt).toContain("Session report excerpt.");
});

test("assert.judge throws AssertionError when verdict fails", async () => {
  mockState.verdict = {
    verdict: "fail",
    score: 0.25,
    reason: "misses required step",
  };

  await expect(
    assert.judge({
      agent: "codex",
      model: "gpt-5",
      rubric: "Return pass only when the report covers required steps.",
      input: "Report text.",
      message: "Judge failed",
    }),
  ).rejects.toMatchObject({
    name: "AssertionError",
    operator: "llmJudge",
    message: expect.stringContaining("Judge failed"),
  });

  await expect(
    assert.judge({
      agent: "codex",
      model: "gpt-5",
      rubric: "Return pass only when the report covers required steps.",
      input: "Report text.",
    }),
  ).rejects.toThrowError("Score: 0.25. Reason: misses required step");
});

test("assert.judge throws AssertionError when score is below threshold", async () => {
  mockState.verdict = {
    verdict: "pass",
    score: 0.4,
    reason: "close but not enough",
  };

  await expect(
    assert.judge({
      agent: "opencode",
      model: "judge-model",
      rubric: "Threshold check.",
      input: "Report text.",
      threshold: 0.5,
    }),
  ).rejects.toMatchObject({
    name: "AssertionError",
    operator: "llmJudge",
    message: expect.stringContaining("0.5"),
  });

  await expect(
    assert.judge({
      agent: "opencode",
      model: "judge-model",
      rubric: "Threshold check.",
      input: "Report text.",
      threshold: 0.5,
    }),
  ).rejects.toThrowError("Score: 0.4. Reason: close but not enough");
});

test("assert.judge validates rubric and input before calling adapter", async () => {
  await expect(
    assert.judge({
      agent: "cursor-agent",
      model: "judge-model",
      rubric: "   ",
      input: "Report text.",
    }),
  ).rejects.toThrowError("assert.judge requires non-empty rubric.");

  await expect(
    assert.judge({
      agent: "cursor-agent",
      model: "judge-model",
      rubric: "Valid rubric.",
      input: "",
    }),
  ).rejects.toThrowError("assert.judge requires non-empty input.");

  expect(mockState.getAdapterCalls).toHaveLength(0);
  expect(mockState.judgeCalls).toHaveLength(0);
});

test("assert.judge lets adapter failures bubble up unchanged", async () => {
  const error = new Error("adapter crashed");
  mockState.judgeError = error;

  await expect(
    assert.judge({
      agent: "claude-code",
      model: "judge-model",
      rubric: "Any rubric.",
      input: "Report text.",
    }),
  ).rejects.toBe(error);
  await expect(
    assert.judge({
      agent: "claude-code",
      model: "judge-model",
      rubric: "Any rubric.",
      input: "Report text.",
    }),
  ).rejects.not.toBeInstanceOf(AssertionError);
});
