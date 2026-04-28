import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, expect, test, vi } from "vitest";
import { execFileCapture } from "../src/utils/process.js";
import { parseArgs } from "../src/utils/cli.js";

const repoRoot = process.cwd();
const tsxLoaderPath = path.join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })));
});

test("cli without args prints full MOTD banner", async () => {
  const result = await execCli([]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("skillgym");
  expect(result.stdout).toContain("Prove your agent skills work before you ship them.");
  expect(result.stdout).not.toContain("by Callstack");
  expect(result.stdout).toContain("skillgym run <suite.ts>");
  expect(result.stdout).toContain("Run a benchmark suite");
  expect(result.stdout).toContain("skillgym help");
});

test("cli help prints full MOTD banner and help sections", async () => {
  const result = await execCli(["help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("skillgym");
  expect(result.stdout).toContain("Prove your agent skills work before you ship them.");
  expect(result.stdout).not.toContain("by Callstack");
  expect(result.stdout).toContain("Usage:");
  expect(result.stdout).toContain("Commands:");
  expect(result.stdout).toContain("Run Options:");
  expect(result.stdout).toContain("--schedule <mode>");
  expect(result.stdout).toContain("Examples:");
});

test("cli run prints compact banner before reporting missing suite path", async () => {
  const result = await execCli(["run"]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("skillgym");
  expect(result.stdout).toContain("Prove your agent skills work before you ship them.");
  expect(result.stdout).not.toContain("by Callstack");
  expect(result.stdout).not.toContain("Run a benchmark suite");
  expect(result.stdout).not.toContain("skillgym help");
  expect(result.stderr).toContain("Error: missing suite path");
  expect(result.stderr).toContain("`skillgym run` needs a suite file to execute.");
  expect(result.stderr).toContain("skillgym run ./examples/basic-suite.ts");
  expect(result.stderr).not.toContain("at main");
});

test("cli parser preserves repeated tag flags", () => {
  expect(parseArgs(["run", "./suite.ts", "--tag", "smoke,gestures", "--tag=regression"])).toEqual({
    command: "run",
    positionals: ["./suite.ts"],
    options: {
      tag: ["smoke,gestures", "regression"],
    },
  });
});

test("cli run reports missing config with suggested fixes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-cli-"));
  tempDirs.push(tempDir);
  await mkdir(path.join(tempDir, "bench"), { recursive: true });
  await writeFile(path.join(tempDir, "bench", "suite.ts"), "export default []\n", "utf8");

  const result = await execCli(["run", "./bench/suite.ts"], tempDir);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Error: missing configuration");
  expect(result.stderr).toContain("skillgym could not find a `skillgym.config.*` file");
  expect(result.stderr).toContain("Create `skillgym.config.ts`, `skillgym.config.mjs`");
  expect(result.stderr).toContain("Use `--config <path>` if your config lives somewhere else.");
  expect(result.stderr).not.toContain("at loadConfig");
});

test("cli run exits non-zero for assertion failures without printing a generic skillgym error", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-cli-"));
  tempDirs.push(tempDir);

  vi.resetModules();
  vi.doMock("../src/config.js", () => ({
    loadConfig: vi.fn(async () => ({
      config: {
        runners: {
          open: { agent: { type: "opencode", model: "openai/gpt-5" } },
        },
      },
      filePath: path.join(tempDir, "skillgym.config.ts"),
    })),
    resolveReporterOptions: vi.fn(() => ({ reporter: undefined, cwd: tempDir })),
    resolveRunOptions: vi.fn(() => ({ cwd: tempDir, outputDir: path.join(tempDir, ".skillgym-results"), schedule: "serial", tags: [] })),
  }));
  vi.doMock("../src/reporters/index.js", () => ({
    loadReporter: vi.fn(async () => undefined),
  }));
  vi.doMock("../src/snapshots/store.js", () => ({
    createSnapshotRuntimeOptions: vi.fn(() => undefined),
  }));
  vi.doMock("../src/runner/load-suite.js", () => ({
    loadSuite: vi.fn(async () => ({
      cases: [{ id: "alpha", prompt: "Say hello", assert() {} }],
      workspace: undefined,
      dirPath: tempDir,
    })),
  }));
  vi.doMock("../src/runner/workspace.js", () => ({
    resolveEffectiveWorkspace: vi.fn(() => ({ mode: "shared", cwd: tempDir })),
  }));
  vi.doMock("../src/runner/execute-suite.js", () => ({
    executeSuite: vi.fn(async () => ({
      suitePath: path.join(tempDir, "suite.ts"),
      startedAt: "2026-04-02T12:00:00.000Z",
      endedAt: "2026-04-02T12:00:01.000Z",
      durationMs: 1_000,
      outputDir: path.join(tempDir, ".skillgym-results", "run-1"),
      declaredTags: [],
      selectedTags: [],
      cases: [{ caseId: "alpha", tags: [], passed: false, runnerResults: [{ passed: false }] }],
      runners: [],
    })),
  }));

  const { RunFailuresError, runCommand } = await import("../src/cli/run.js");

  await expect(runCommand({ suitePath: "./suite.ts", cwd: tempDir })).rejects.toBeInstanceOf(RunFailuresError);

  vi.doUnmock("../src/config.js");
  vi.doUnmock("../src/reporters/index.js");
  vi.doUnmock("../src/snapshots/store.js");
  vi.doUnmock("../src/runner/load-suite.js");
  vi.doUnmock("../src/runner/workspace.js");
  vi.doUnmock("../src/runner/execute-suite.js");
});

test("cli run passes repeated and comma-separated tag filters to execution", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-cli-"));
  tempDirs.push(tempDir);
  const executeSuite = vi.fn(async () => ({
    suitePath: path.join(tempDir, "suite.ts"),
    startedAt: "2026-04-02T12:00:00.000Z",
    endedAt: "2026-04-02T12:00:01.000Z",
    durationMs: 1_000,
    outputDir: path.join(tempDir, ".skillgym-results", "run-1"),
    declaredTags: ["smoke", "gestures", "regression"],
    selectedTags: ["smoke", "gestures", "regression"],
    cases: [{ caseId: "alpha", tags: ["smoke"], passed: true, runnerResults: [{ passed: true }] }],
    runners: [],
  }));

  vi.resetModules();
  vi.doMock("../src/config.js", () => ({
    loadConfig: vi.fn(async () => ({
      config: {
        runners: {
          open: { agent: { type: "opencode", model: "openai/gpt-5" } },
        },
      },
      filePath: path.join(tempDir, "skillgym.config.ts"),
    })),
    resolveReporterOptions: vi.fn(() => ({ reporter: undefined, cwd: tempDir })),
    resolveRunOptions: vi.fn((options) => ({ cwd: tempDir, outputDir: path.join(tempDir, ".skillgym-results"), schedule: "serial", tags: options.tags })),
  }));
  vi.doMock("../src/reporters/index.js", () => ({
    loadReporter: vi.fn(async () => undefined),
  }));
  vi.doMock("../src/snapshots/store.js", () => ({
    createSnapshotRuntimeOptions: vi.fn(() => undefined),
  }));
  vi.doMock("../src/runner/load-suite.js", () => ({
    loadSuite: vi.fn(async () => ({
      cases: [{ id: "alpha", prompt: "Say hello", tags: ["smoke"], assert() {} }],
      workspace: undefined,
      dirPath: tempDir,
    })),
  }));
  vi.doMock("../src/runner/workspace.js", () => ({
    resolveEffectiveWorkspace: vi.fn(() => ({ mode: "shared", cwd: tempDir })),
  }));
  vi.doMock("../src/runner/execute-suite.js", () => ({ executeSuite }));

  const { runCommand } = await import("../src/cli/run.js");

  await runCommand({ suitePath: "./suite.ts", cwd: tempDir, tags: ["smoke", "gestures", "regression"] });

  expect(executeSuite).toHaveBeenCalledWith("./suite.ts", expect.any(Array), expect.objectContaining({
    tags: ["smoke", "gestures", "regression"],
  }));

  vi.doUnmock("../src/config.js");
  vi.doUnmock("../src/reporters/index.js");
  vi.doUnmock("../src/snapshots/store.js");
  vi.doUnmock("../src/runner/load-suite.js");
  vi.doUnmock("../src/runner/workspace.js");
  vi.doUnmock("../src/runner/execute-suite.js");
});

async function execCli(args: string[], cwd = repoRoot) {
  return execFileCapture(
    process.execPath,
    ["--import", tsxLoaderPath, path.join(repoRoot, "index.ts"), ...args],
    {
      cwd,
      timeoutMs: 30_000,
    },
  );
}
