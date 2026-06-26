import { expect, test } from "vitest";
import { parseJudgeVerdict } from "../../src/domain/judge.js";

test("parseJudgeVerdict accepts direct pass JSON", () => {
  expect(
    parseJudgeVerdict('{"verdict":"pass","score":1,"reason":"meets rubric"}'),
  ).toEqual({
    verdict: "pass",
    score: 1,
    reason: "meets rubric",
  });
});

test("parseJudgeVerdict accepts fenced fail JSON in surrounding text", () => {
  expect(
    parseJudgeVerdict(
      [
        "judge result:",
        "```json",
        '{"verdict":"fail","score":0.25,"reason":"misses required step"}',
        "```",
        "done",
      ].join("\n"),
    ),
  ).toEqual({
    verdict: "fail",
    score: 0.25,
    reason: "misses required step",
  });
});

test("parseJudgeVerdict rejects invalid JSON", () => {
  expect(() => parseJudgeVerdict("not json")).toThrowError(
    "Judge output did not contain a JSON object.",
  );
});

test("parseJudgeVerdict rejects invalid score", () => {
  expect(() =>
    parseJudgeVerdict('{"verdict":"pass","score":1.5,"reason":"too high"}'),
  ).toThrowError("Judge score must be a finite number between 0 and 1.");
});

test("parseJudgeVerdict rejects invalid verdict", () => {
  expect(() =>
    parseJudgeVerdict('{"verdict":"maybe","score":0.5,"reason":"unclear"}'),
  ).toThrowError('Judge verdict must be "pass" or "fail".');
});

test("parseJudgeVerdict rejects missing reason", () => {
  expect(() => parseJudgeVerdict('{"verdict":"pass","score":0.5,"reason":""}')).toThrowError(
    "Judge reason must be a non-empty string.",
  );
});
