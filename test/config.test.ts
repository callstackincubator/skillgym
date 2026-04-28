import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { RunnerResult, TestCase } from "../src/index.js";
import { loadConfig, parseConfig, resolveReporterOptions, resolveRunOptions } from "../src/config.js";
import { executeSuite } from "../src/runner/execute-suite.js";
import { createRunnerInfo } from "../src/runner/runner-info.js";
import { createSessionReport } from "./helpers/session-report.js";

describe("config", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-config-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("loads .mjs config discovered from suite directory upward", async () => {
    const suiteDir = path.join(tempDir, "bench", "nested");
    await mkdir(suiteDir, { recursive: true });
    await writeFile(path.join(suiteDir, "suite.ts"), "export default []\n", "utf8");
    await writeFile(
      path.join(tempDir, "bench", "skillgym.config.mjs"),
        [
          "export default {",
          "  run: { cwd: './workspace', outputDir: './results', reporter: './reporters/custom.ts', schedule: 'serial', maxParallel: 3, workspace: { mode: 'isolated', templateDir: './fixtures/base', bootstrap: { command: './scripts/bootstrap.sh', args: ['--flag'], timeoutMs: 5000 } } },",
          "  defaults: { timeoutMs: 45000 },",
          "  runners: {",
          "    codexMain: { agent: { type: 'codex', command: './bin/codex', commandArgs: ['./scripts/wrapper.ts'], model: 'gpt-5' } }",
          "  }",
          "};",
          "",
        ].join("\n"),
      "utf8",
    );

    const loaded = await loadConfig({ suitePath: path.join(suiteDir, "suite.ts") });

    expect(loaded.filePath).toBe(path.join(tempDir, "bench", "skillgym.config.mjs"));
    expect(loaded.config).toEqual({
      run: {
        cwd: path.join(tempDir, "bench", "workspace"),
        outputDir: path.join(tempDir, "bench", "results"),
        reporter: path.join(tempDir, "bench", "reporters", "custom.ts"),
        schedule: "serial",
        maxParallel: 3,
        workspace: {
          mode: "isolated",
          templateDir: path.join(tempDir, "bench", "fixtures", "base"),
          bootstrap: {
            command: path.join(tempDir, "bench", "scripts", "bootstrap.sh"),
            args: ["--flag"],
            timeoutMs: 5000,
          },
        },
      },
      defaults: {
        timeoutMs: 45000,
      },
      snapshots: undefined,
      runners: {
        codexMain: {
          agent: {
            type: "codex",
            command: path.join(tempDir, "bench", "bin", "codex"),
            commandArgs: [path.join(tempDir, "bench", "scripts", "wrapper.ts")],
            model: "gpt-5",
          },
        },
      },
    });
  });

  test("loads .cjs config with explicit path", async () => {
    const suitePath = path.join(tempDir, "suite.ts");
    const configPath = path.join(tempDir, "custom.config.cjs");
    await writeFile(suitePath, "export default []\n", "utf8");
    await writeFile(
      configPath,
      [
        "module.exports = {",
        "  runners: {",
        "    openCi: { agent: { type: 'opencode', command: './bin/opencode', env: { OPENCODE_PROFILE: 'ci' }, model: 'openai/gpt-5' } }",
        "  }",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    const loaded = await loadConfig({ suitePath, configPath });

    expect(loaded.filePath).toBe(configPath);
    expect(loaded.config.runners.openCi).toEqual({
      agent: {
        type: "opencode",
        command: path.join(tempDir, "bin", "opencode"),
        env: { OPENCODE_PROFILE: "ci" },
        model: "openai/gpt-5",
      },
    });
    expect(loaded.config.snapshots).toBeUndefined();
  });

  test("parses snapshot config and resolves path from config directory", async () => {
    const suiteDir = path.join(tempDir, "bench");
    const suitePath = path.join(suiteDir, "suite.ts");
    const configPath = path.join(suiteDir, "skillgym.config.mjs");
    await mkdir(suiteDir, { recursive: true });
    await writeFile(suitePath, "export default []\n", "utf8");
    await writeFile(
      configPath,
      [
        "export default {",
        "  snapshots: { path: './snapshots.json', metric: 'outputTokens', tolerance: { absolute: 40, percent: 20 } },",
        "  runners: { open: { agent: { type: 'opencode', model: 'openai/gpt-5' } } }",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    const loaded = await loadConfig({ suitePath, configPath });

    expect(loaded.config.snapshots).toEqual({
      path: path.join(suiteDir, "snapshots.json"),
      metric: "outputTokens",
      tolerance: {
        absolute: 40,
        percent: 20,
      },
    });
  });

  test("requires config discovery with runners", async () => {
    const suitePath = path.join(tempDir, "suite.ts");
    await writeFile(suitePath, "export default []\n", "utf8");

    await expect(loadConfig({ suitePath })).rejects.toThrow(
      "No skillgym config found. Create skillgym.config.ts with a non-empty runners map.",
    );
  });

  test("rejects unknown keys with full path", () => {
    expect(() => parseConfig({ runners: { codexMain: { agent: { type: "codex", model: "gpt-5", sessionPath: "/tmp/x" } } } })).toThrow(
      "Unknown config key: runners.codexMain.agent.sessionPath",
    );
  });

  test("rejects invalid schema values with full path", () => {
    expect(() => parseConfig({ runners: {} })).toThrow(
      "Invalid config at runners: expected non-empty object",
    );
    expect(() => parseConfig({ runners: { codexMain: { agent: { type: "codex", model: "gpt-5", commandArgs: [""] } } } })).toThrow(
      "Invalid config at runners.codexMain.agent.commandArgs[0]: expected non-empty string",
    );
    expect(() => parseConfig({ runners: { openMain: { agent: { type: "opencode" } } } })).toThrow(
      "Invalid config at runners.openMain.agent.model: expected non-empty string",
    );
    expect(() => parseConfig({ runners: { openMain: { agent: { type: "opencode", model: "" } } } })).toThrow(
      "Invalid config at runners.openMain.agent.model: expected non-empty string",
    );
    expect(() => parseConfig({
      run: { workspace: { mode: "shared", templateDir: "./fixture" } },
      runners: { openMain: { agent: { type: "opencode", model: "openai/gpt-5" } } },
    })).toThrow('Invalid config at run.workspace.templateDir: expected this key to be omitted when workspace mode is "shared"');
    expect(() => parseConfig({
      snapshots: { tolerance: {} },
      runners: { openMain: { agent: { type: "opencode", model: "openai/gpt-5" } } },
    })).toThrow("Invalid config at snapshots.tolerance: expected at least one of absolute or percent");
    expect(() => parseConfig({
      run: { schedule: "fanout" },
      runners: { openMain: { agent: { type: "opencode", model: "openai/gpt-5" } } },
    })).toThrow("Invalid config at run.schedule: expected one of: serial, parallel, isolated-by-runner");
  });

  test("parses valid schedule values", () => {
    expect(parseConfig({ run: { schedule: "serial" }, runners: { open: { agent: { type: "opencode", model: "openai/gpt-5" } } } }).run?.schedule).toBe("serial");
    expect(parseConfig({ run: { schedule: "parallel" }, runners: { open: { agent: { type: "opencode", model: "openai/gpt-5" } } } }).run?.schedule).toBe("parallel");
    expect(parseConfig({ run: { schedule: "isolated-by-runner" }, runners: { open: { agent: { type: "opencode", model: "openai/gpt-5" } } } }).run?.schedule).toBe("isolated-by-runner");
  });

  test("parses run maxSteps", () => {
    const parsed = parseConfig({
      run: { maxSteps: 3 },
      runners: { open: { agent: { type: "opencode", model: "openai/gpt-5" } } },
    });

    expect(parsed.run?.maxSteps).toBe(3);
  });

  test("parses run maxParallel", () => {
    const parsed = parseConfig({
      run: { maxParallel: 3 },
      runners: { open: { agent: { type: "opencode", model: "openai/gpt-5" } } },
    });

    expect(parsed.run?.maxParallel).toBe(3);
  });

  test("accepts cursor-agent runner configs", () => {
    const parsed = parseConfig({
      runners: {
        cursor: {
          agent: {
            type: "cursor-agent",
            command: "agent",
            model: "composer-2-fast",
          },
        },
      },
    });

    expect(parsed.runners.cursor?.agent).toEqual({
      type: "cursor-agent",
      command: "agent",
      commandArgs: undefined,
      env: undefined,
      model: "composer-2-fast",
    });
  });

  test("throws when multiple config files exist in the same directory", async () => {
    const suiteDir = path.join(tempDir, "bench");
    await mkdir(suiteDir, { recursive: true });
    await writeFile(path.join(suiteDir, "suite.ts"), "export default []\n", "utf8");
    await writeFile(path.join(suiteDir, "skillgym.config.mjs"), "export default { runners: { open: { agent: { type: 'opencode', model: 'openai/gpt-5' } } } };\n", "utf8");
    await writeFile(path.join(suiteDir, "skillgym.config.cjs"), "module.exports = { runners: { open: { agent: { type: 'opencode', model: 'openai/gpt-5' } } } };\n", "utf8");

    await expect(loadConfig({ suitePath: path.join(suiteDir, "suite.ts") })).rejects.toThrow(
      new RegExp(`Multiple config files found in ${escapeRegex(suiteDir)}`),
    );
  });

  test("run options prefer CLI over config and config over built-ins", () => {
    const resolved = resolveRunOptions(
      {
        cwd: path.join(tempDir, "cli-workspace"),
      },
      {
        run: {
          cwd: path.join(tempDir, "config-workspace"),
          outputDir: path.join(tempDir, "config-results"),
          schedule: "parallel",
          maxParallel: 2,
        },
        runners: {
          open: { agent: { type: "opencode", model: "openai/gpt-5" } },
        },
      },
    );

    expect(resolved).toEqual({
      cwd: path.join(tempDir, "cli-workspace"),
      outputDir: path.join(tempDir, "config-results"),
      schedule: "parallel",
      maxParallel: 2,
    });
  });

  test("run options let CLI maxParallel override config", () => {
    expect(resolveRunOptions(
      { maxParallel: "4" },
      { run: { maxParallel: 2 }, runners: { open: { agent: { type: "opencode", model: "openai/gpt-5" } } } },
    )).toMatchObject({ maxParallel: 4 });

    expect(() => resolveRunOptions(
      { maxParallel: "0" },
      { runners: { open: { agent: { type: "opencode", model: "openai/gpt-5" } } } },
    )).toThrow("Invalid config at CLI option --max-parallel: expected integer >= 1");
  });

  test("run options let CLI schedule override config and default to serial", () => {
    expect(resolveRunOptions(
      { schedule: "isolated-by-runner" },
      { run: { schedule: "parallel" }, runners: { open: { agent: { type: "opencode", model: "openai/gpt-5" } } } },
    )).toMatchObject({ schedule: "isolated-by-runner" });

    expect(resolveRunOptions(
      {},
      { run: { schedule: "parallel" }, runners: { open: { agent: { type: "opencode", model: "openai/gpt-5" } } } },
    )).toMatchObject({ schedule: "parallel" });

    expect(resolveRunOptions(
      {},
      { runners: { open: { agent: { type: "opencode", model: "openai/gpt-5" } } } },
    )).toMatchObject({ schedule: "serial" });
  });

  test("reporter options prefer CLI over config and config over built-ins", async () => {
    const configDir = path.join(tempDir, "bench");
    const suitePath = path.join(configDir, "suite.ts");
    const configPath = path.join(configDir, "skillgym.config.mjs");
    await mkdir(configDir, { recursive: true });
    await writeFile(suitePath, "export default []\n", "utf8");
    await writeFile(
      configPath,
      "export default { run: { reporter: './reporters/config-reporter.ts' }, runners: { open: { agent: { type: 'opencode', model: 'openai/gpt-5' } } } };\n",
      "utf8",
    );

    const loaded = await loadConfig({ suitePath, configPath });

    expect(resolveReporterOptions({ reporter: "./cli-reporter.ts", cwd: tempDir }, loaded)).toEqual({
      reporter: "./cli-reporter.ts",
      cwd: tempDir,
    });
    expect(resolveReporterOptions({}, loaded)).toEqual({
      reporter: path.join(configDir, "reporters", "config-reporter.ts"),
      cwd: configDir,
    });
  });

  test("executeSuite applies per-case timeout over config defaults and runs every case against selected runners", async () => {
    const workspaceDir = path.join(tempDir, "workspace");
    const outputDir = path.join(tempDir, "results");
    await mkdir(workspaceDir, { recursive: true });

    const seen: Array<{ caseId: string; runnerId: string; timeoutMs: number }> = [];
    const cases: TestCase[] = [
      { id: "from-config", prompt: "a", assert() {} },
      { id: "from-case", prompt: "b", timeoutMs: 7000, assert() {} },
    ];

    const result = await executeSuite("./suite.ts", cases, {
      cwd: workspaceDir,
      outputDir,
      config: {
        defaults: {
          timeoutMs: 45000,
        },
        runners: {
          open: { agent: { type: "opencode", model: "openai/gpt-5" } },
          code: { agent: { type: "codex", model: "gpt-5" } },
        },
      },
      isInteractive: false,
      executeRunnerFn: async (testCase, runner, _adapter, options) => {
        seen.push({ caseId: testCase.id, runnerId: runner.id, timeoutMs: options.timeoutMs });
        return createRunnerResult({
          runner,
          artifactDir: options.artifactDir,
        });
      },
    });

    expect(result.cases.map((item) => [item.caseId, item.runnerResults.length])).toEqual([
      ["from-config", 2],
      ["from-case", 2],
    ]);
    expect(seen).toEqual([
      { caseId: "from-config", runnerId: "open", timeoutMs: 45000 },
      { caseId: "from-config", runnerId: "code", timeoutMs: 45000 },
      { caseId: "from-case", runnerId: "open", timeoutMs: 7000 },
      { caseId: "from-case", runnerId: "code", timeoutMs: 7000 },
    ]);
  });
});

function createRunnerResult(options: {
  runner: ReturnType<typeof createRunnerInfo>;
  artifactDir: string;
}): RunnerResult {
  return {
    runner: options.runner,
    passed: true,
    durationMs: 10,
    artifactDir: options.artifactDir,
    report: createSessionReport({ runner: options.runner }),
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
