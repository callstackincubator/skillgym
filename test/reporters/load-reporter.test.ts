import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadReporter } from "../../src/reporters/load-reporter.ts";

describe("loadReporter", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-reporter-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("resolves built-in reporter when omitted", async () => {
    const reporter = await loadReporter(undefined, tempDir);

    expect(typeof reporter.onSuiteStart).toBe("function");
    expect(typeof reporter.onSuiteFinish).toBe("function");
  });

  test("resolves built-in reporter when standard is provided", async () => {
    const reporter = await loadReporter("standard", tempDir);

    expect(typeof reporter.onCaseFinish).toBe("function");
  });

  test("loads custom reporter from relative default export path", async () => {
    const filePath = path.join(tempDir, "default-reporter.ts");
    await writeFile(filePath, 'export default { onSuiteStart() {} };\n', "utf8");

    const reporter = await loadReporter("./default-reporter.ts", tempDir);

    expect(typeof reporter.onSuiteStart).toBe("function");
  });

  test("loads custom reporter from named export path", async () => {
    const filePath = path.join(tempDir, "named-reporter.ts");
    await writeFile(filePath, 'export const reporter = { onSuiteFinish() {} };\n', "utf8");

    const reporter = await loadReporter("./named-reporter.ts", tempDir);

    expect(typeof reporter.onSuiteFinish).toBe("function");
  });

  test("throws useful error for invalid shape", async () => {
    const filePath = path.join(tempDir, "invalid-reporter.ts");
    await writeFile(filePath, 'export default { hello() {} };\n', "utf8");

    await expect(loadReporter("./invalid-reporter.ts", tempDir)).rejects.toThrow(
      /Reporter module must define at least one reporter hook .*invalid-reporter\.ts/,
    );
  });
});
