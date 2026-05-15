import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import type { Case } from "../../src/index.js";
import { executeSuite } from "../../src/runner/execute-suite.js";
import { loadSuite } from "../../src/runner/load-suite.js";
import { createRunnerInfo } from "../../src/runner/runner-info.js";
import { createSessionReport } from "../helpers/session-report.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })),
  );
});

test("loadSuite reads named workspace export", async () => {
  const suiteDir = await createTempDir();
  const suitePath = path.join(suiteDir, "suite.ts");
  await writeFile(
    suitePath,
    [
      "export const workspace = { mode: 'isolated', templateDir: './fixture' };",
      "export default [{ id: 'alpha', prompt: 'hello', assert() {} }];",
      "",
    ].join("\n"),
    "utf8",
  );

  const loaded = await loadSuite(suitePath);

  expect(loaded.filePath).toBe(suitePath);
  expect(loaded.dirPath).toBe(suiteDir);
  expect(loaded.workspace).toEqual({ mode: "isolated", templateDir: "./fixture" });
  expect(loaded.cases).toHaveLength(1);
});

test("executeSuite provisions isolated workspaces from suite template and removes them on success", async () => {
  const tempDir = await createTempDir();
  const suiteRunArtifactDir = path.join(tempDir, "results");
  const templateDir = path.join(tempDir, "template");
  await mkdir(templateDir, { recursive: true });
  await writeFile(path.join(templateDir, "README.md"), "template\n", "utf8");
  await mkdir(path.join(templateDir, ".git"), { recursive: true });
  await writeFile(path.join(templateDir, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");

  const seenCwds: string[] = [];
  const cases: Case[] = [{ id: "alpha", prompt: "hello", assert() {} }];
  const runner = createRunnerInfo("open", { type: "opencode", model: "openai/gpt-5" });

  const result = await executeSuite("./suite.ts", cases, {
    cwd: tempDir,
    suiteRunArtifactDir,
    suiteWorkspace: {
      mode: "isolated",
      templateDir,
    },
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
      },
    },
    executeRunnerFn: async (_case, _runner, _adapter, options) => {
      seenCwds.push(options.cwd);
      expect(await readFile(path.join(options.cwd, "README.md"), "utf8")).toBe("template\n");
      expect(await readFile(path.join(options.cwd, ".git", "HEAD"), "utf8")).toContain(
        "refs/heads/main",
      );
      return {
        runner,
        passed: true,
        status: "passed",
        durationMs: 10,
        executionArtifactDir: options.artifactDir,
        artifactDir: options.artifactDir,
        report: createSessionReport({ runner, prompt: "hello" }),
      };
    },
  });
  const runOutputDir = result.suiteRunArtifactDir;

  expect(result.cases[0]?.passed).toBe(true);
  expect(seenCwds).toHaveLength(1);
  await expect(stat(seenCwds[0]!)).rejects.toThrow();

  const workspaceMetadata = await readFile(
    path.join(runOutputDir, "alpha", runner.pathKey, "repeat-1", "workspace.json"),
    "utf8",
  );
  expect(workspaceMetadata).toContain('"mode": "isolated"');
  expect(workspaceMetadata).toContain('"preserved": false');
});

test("executeSuite provisions shared workspace from template and bootstrap before runner starts", async () => {
  const tempDir = await createTempDir();
  const suiteRunArtifactDir = path.join(tempDir, "results");
  const templateDir = path.join(tempDir, "template");
  const suiteDir = path.join(tempDir, "suite-dir");
  const scriptPath = path.join(suiteDir, "bootstrap.sh");

  await mkdir(templateDir, { recursive: true });
  await mkdir(suiteDir, { recursive: true });
  await writeFile(path.join(templateDir, "README.md"), "template\n", "utf8");
  await writeFile(
    scriptPath,
    [
      "#!/bin/sh",
      "printf 'Bootstrap marker: shared\\n' > bootstrap-output.txt",
      "count=$(cat bootstrap-count.txt 2>/dev/null || printf '0')",
      "printf '%s' $((count + 1)) > bootstrap-count.txt",
      "",
    ].join("\n"),
    "utf8",
  );

  const runner = createRunnerInfo("open", { type: "opencode", model: "openai/gpt-5" });
  const seenCwds: string[] = [];
  const result = await executeSuite(
    path.join(suiteDir, "suite.ts"),
    [
      { id: "alpha", prompt: "hello", assert() {} },
      { id: "beta", prompt: "hello", assert() {} },
    ],
    {
      cwd: tempDir,
      suiteRunArtifactDir,
      suiteWorkspace: {
        mode: "shared",
        templateDir,
        bootstrap: {
          command: "sh",
          args: ["./bootstrap.sh"],
        },
      },
      config: {
        runners: {
          open: { agent: { type: "opencode", model: "openai/gpt-5" } },
        },
      },
      executeRunnerFn: async (_case, _runner, _adapter, options) => {
        seenCwds.push(options.cwd);
        expect(await readFile(path.join(options.cwd, "README.md"), "utf8")).toBe("template\n");
        expect(await readFile(path.join(options.cwd, "bootstrap-output.txt"), "utf8")).toContain(
          "shared",
        );
        expect(await readFile(path.join(options.cwd, "bootstrap-count.txt"), "utf8")).toBe("1");

        return {
          runner,
          passed: true,
          status: "passed",
          durationMs: 10,
          executionArtifactDir: options.artifactDir,
          artifactDir: options.artifactDir,
          report: createSessionReport({ runner, prompt: "hello" }),
        };
      },
    },
  );

  expect(result.cases[0]?.passed).toBe(true);
  expect(result.cases[1]?.passed).toBe(true);
  expect(new Set(seenCwds).size).toBe(1);
  const sharedWorkspaceDir = seenCwds[0]!;
  await expect(stat(sharedWorkspaceDir)).rejects.toThrow();

  const executionArtifactDir = path.join(
    result.suiteRunArtifactDir,
    "alpha",
    runner.pathKey,
    "repeat-1",
  );
  const workspaceMetadata = await readFile(
    path.join(executionArtifactDir, "workspace.json"),
    "utf8",
  );
  const stdout = await readFile(
    path.join(result.suiteRunArtifactDir, "workspaces", "shared-setup", "bootstrap.stdout.log"),
    "utf8",
  );

  expect(workspaceMetadata).toContain('"mode": "shared"');
  expect(workspaceMetadata).toContain(JSON.stringify(sharedWorkspaceDir));
  expect(workspaceMetadata).toContain(JSON.stringify(templateDir));
  expect(stdout).toBe("");
});

test("executeSuite defaults to none workspace when config and suite omit workspace", async () => {
  const tempDir = await createTempDir();
  const suiteRunArtifactDir = path.join(tempDir, "results");
  const runner = createRunnerInfo("open", { type: "opencode", model: "openai/gpt-5" });
  const seenCwds: string[] = [];

  const result = await executeSuite("./suite.ts", [{ id: "alpha", prompt: "hello", assert() {} }], {
    cwd: tempDir,
    suiteRunArtifactDir,
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
      },
    },
    executeRunnerFn: async (_case, _runner, _adapter, options) => {
      seenCwds.push(options.cwd);
      return {
        runner,
        passed: true,
        status: "passed",
        durationMs: 10,
        executionArtifactDir: options.artifactDir,
        artifactDir: options.artifactDir,
        report: createSessionReport({ runner, prompt: "hello" }),
      };
    },
  });

  expect(result.cases[0]?.passed).toBe(true);
  expect(seenCwds).toEqual([tempDir]);
  expect(
    await readFile(
      path.join(result.suiteRunArtifactDir, "alpha", runner.pathKey, "repeat-1", "workspace.json"),
      "utf8",
    ),
  ).toContain('"mode": "none"');
});

test("executeSuite preserves failed isolated workspaces and writes bootstrap logs", async () => {
  const tempDir = await createTempDir();
  const suiteRunArtifactDir = path.join(tempDir, "results");
  const scriptPath = path.join(tempDir, "bootstrap.sh");
  await writeFile(
    scriptPath,
    ["#!/bin/sh", "echo bootstrap-start", "echo $SKILLGYM_CASE_ID >&2", "exit 4", ""].join("\n"),
    "utf8",
  );
  const runner = createRunnerInfo("open", { type: "opencode", model: "openai/gpt-5" });

  const result = await executeSuite("./suite.ts", [{ id: "alpha", prompt: "hello", assert() {} }], {
    cwd: tempDir,
    suiteRunArtifactDir,
    suiteWorkspace: {
      mode: "isolated",
      bootstrap: {
        command: "sh",
        args: [scriptPath],
      },
    },
    config: {
      runners: {
        open: { agent: { type: "opencode", model: "openai/gpt-5" } },
      },
    },
    executeRunnerFn: async () => {
      throw new Error("runner should not start when bootstrap fails");
    },
  });
  const runOutputDir = result.suiteRunArtifactDir;

  expect(result.cases[0]?.runnerResults[0]?.passed).toBe(false);
  expect(result.cases[0]?.runnerResults[0]?.error?.message).toContain("Workspace bootstrap failed");
  expect(result.cases[0]?.runnerResults[0]?.failureOrigin).toBe("workspace-bootstrap");
  expect(result.cases[0]?.runnerResults[0]?.failureLogPath).toBe(
    path.join(runOutputDir, "alpha", runner.pathKey, "repeat-1", "bootstrap.stderr.log"),
  );

  const workspaceRoot = path.join(runOutputDir, "workspaces", "alpha");
  const entries = await readdir(workspaceRoot);
  expect(entries.length).toBe(1);
  const preservedWorkspace = path.join(workspaceRoot, entries[0]!);
  expect((await stat(preservedWorkspace)).isDirectory()).toBe(true);

  const executionArtifactDir = path.join(runOutputDir, "alpha", runner.pathKey, "repeat-1");
  const stdout = await readFile(path.join(executionArtifactDir, "bootstrap.stdout.log"), "utf8");
  const stderr = await readFile(path.join(executionArtifactDir, "bootstrap.stderr.log"), "utf8");
  const workspaceMetadata = await readFile(
    path.join(executionArtifactDir, "workspace.json"),
    "utf8",
  );

  expect(stdout).toContain("bootstrap-start");
  expect(stderr).toContain("alpha");
  expect(workspaceMetadata).toContain('"preserved": true');
});

test("executeSuite resolves suite-relative bootstrap script args before running in isolated workspace", async () => {
  const tempDir = await createTempDir();
  const suiteRunArtifactDir = path.join(tempDir, "results");
  const suiteDir = path.join(tempDir, "suite-dir");
  const scriptPath = path.join(suiteDir, "bootstrap.sh");
  await mkdir(suiteDir, { recursive: true });
  await writeFile(
    scriptPath,
    "#!/bin/sh\nprintf 'Bootstrap marker: suite-relative\\n' > bootstrap-output.txt\n",
    "utf8",
  );

  const runner = createRunnerInfo("open", { type: "opencode", model: "openai/gpt-5" });
  let seenCwd = "";
  const result = await executeSuite(
    path.join(suiteDir, "suite.ts"),
    [{ id: "alpha", prompt: "hello", assert() {} }],
    {
      cwd: tempDir,
      suiteRunArtifactDir,
      suiteWorkspace: {
        mode: "isolated",
        bootstrap: {
          command: "sh",
          args: ["./bootstrap.sh"],
        },
      },
      config: {
        runners: {
          open: { agent: { type: "opencode", model: "openai/gpt-5" } },
        },
      },
      executeRunnerFn: async (_case, _runner, _adapter, options) => {
        seenCwd = options.cwd;
        expect(await readFile(path.join(options.cwd, "bootstrap-output.txt"), "utf8")).toContain(
          "suite-relative",
        );
        return {
          runner,
          passed: true,
          status: "passed",
          durationMs: 10,
          executionArtifactDir: options.artifactDir,
          artifactDir: options.artifactDir,
          report: createSessionReport({ runner, prompt: "hello" }),
        };
      },
    },
  );

  expect(result.cases[0]?.passed).toBe(true);
  expect(seenCwd).not.toBe("");
});

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-workspace-test-"));
  tempDirs.push(tempDir);
  return tempDir;
}
