import { describe, expectTypeOf, it } from "vitest";
import type { Case, Suite, TestCase, TestSuite } from "../src/index.js";

describe("public API compatibility", () => {
  it("exports TestCase as an alias of Case", () => {
    expectTypeOf<TestCase>().toEqualTypeOf<Case>();
  });

  it("exports TestSuite as an alias of Suite", () => {
    expectTypeOf<TestSuite>().toEqualTypeOf<Suite>();
  });
});
