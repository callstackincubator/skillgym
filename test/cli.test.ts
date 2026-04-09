import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, expect, test } from "vitest";
import { execFileCapture } from "../src/utils/process.js";

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
