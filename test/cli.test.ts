import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  await Promise.all(
    tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })),
  );
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
  expect(result.stdout).toContain("skillgym skills get core");
  expect(result.stdout).toContain("Commands:");
  expect(result.stdout).toContain("explain <artifactDir>");
  expect(result.stdout).toContain("Explain Options:");
  expect(result.stdout).toContain("--rerun");
  expect(result.stdout).toContain("skills list");
  expect(result.stdout).toContain("skills get <name>");
  expect(result.stdout).toContain("Run Options:");
  expect(result.stdout).toContain("--schedule <mode>");
  expect(result.stdout).toContain("--max-parallel <n>");
  expect(result.stdout).toContain("--repeat <n>");
  expect(result.stdout).toContain("--repeat-failure <n>");
  expect(result.stdout).toContain("--retry-failed <n>");
  expect(result.stdout).toContain("Examples:");
});

test("cli skills list prints bundled skill names", async () => {
  const result = await execCli(["skills", "list"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("assertions");
  expect(result.stdout).toContain("core");
  expect(result.stdout).toContain("reporters");
  expect(result.stdout).toContain("snapshots");
  expect(result.stdout).toContain("test-cases");
  expect(result.stdout).toContain("workspaces");
});

test("cli skills get core prints the bundled core skill", async () => {
  const result = await execCli(["skills", "get", "core"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("# skillgym core");
  expect(result.stdout).toContain("skillgym skills get test-cases");
  expect(result.stdout).toContain("skillgym run <suite.ts>");
});

test("cli skills get reports missing skill name without printing MOTD banner", async () => {
  const result = await execCli(["skills", "get"]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Missing skill name. Usage: skillgym skills get <name>");
  expect(result.stderr).not.toContain("Prove your agent skills work before you ship them.");
});

test("cli run reports missing suite path without printing MOTD banner", async () => {
  const result = await execCli(["run"]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Error: missing suite path");
  expect(result.stderr).toContain("`skillgym run` needs a suite file to execute.");
  expect(result.stderr).toContain("skillgym run ./examples/basic-suite.ts");
  expect(result.stderr).not.toContain("at main");
});

test("cli explain reports missing artifact directory without printing MOTD banner", async () => {
  const result = await execCli(["explain"]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(
    "Missing artifact directory. Usage: skillgym explain <artifactDir>",
  );
  expect(result.stderr).not.toContain("Prove your agent skills work before you ship them.");
});

test("explainCommand writes explanations.json from persisted explain questions", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-cli-"));
  tempDirs.push(tempDir);
  const artifactDir = path.join(tempDir, "alpha", "open-main", "repeat-1");
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, "report.json"),
    `${JSON.stringify({
      runner: {
        id: "open-main",
        pathKey: "open-main",
        agent: { type: "opencode", model: "openai/gpt-5" },
      },
      prompt: "prompt",
      usage: {
        inputChars: 0,
        outputChars: 0,
        reasoningChars: 0,
        source: { input: "chars", output: "chars", reasoning: "chars" },
      },
      files: { observedReads: [], observedSkillReads: [] },
      detectedSkills: [],
      events: [],
      finalOutput: "",
      rawArtifacts: {},
    })}\n`,
    "utf8",
  );
  await writeFile(
    path.join(artifactDir, "explain.json"),
    `${JSON.stringify({
      suitePath: path.join(tempDir, "suite.ts"),
      caseId: "alpha",
      runnerId: "open-main",
      cwd: tempDir,
      sessionId: "ses_123",
      questions: [
        {
          question: "Why did you skip SKILL.md?",
          source: { filePath: path.join(tempDir, "suite.ts"), line: "12", column: "5" },
        },
      ],
    })}\n`,
    "utf8",
  );

  const explain = vi.fn(async () => ({
    answers: [
      {
        question: {
          question: "Why did you skip SKILL.md?",
          source: { filePath: path.join(tempDir, "suite.ts"), line: "12", column: "5" },
        },
        answer: "Because the prompt looked sufficient.",
        sessionId: "ses_123",
        startedAt: "2026-05-07T10:00:00.000Z",
        endedAt: "2026-05-07T10:00:01.000Z",
        durationMs: 1_000,
        rawArtifacts: {
          stdoutPath: path.join(artifactDir, "explain", "question-01", "stdout.log"),
        },
      },
    ],
  }));

  vi.resetModules();
  vi.doMock("../src/config.js", () => ({
    loadConfig: vi.fn(async () => ({
      config: {
        runners: {
          "open-main": { agent: { type: "opencode", model: "openai/gpt-5" } },
        },
      },
    })),
  }));
  vi.doMock("../src/adapters/index.js", () => ({
    getAdapter: vi.fn(() => ({
      run: vi.fn(),
      collect: vi.fn(),
      normalize: vi.fn(),
      explain,
    })),
  }));

  const output: string[] = [];
  const stdout = {
    isTTY: false,
    write(value: string) {
      output.push(value);
      return true;
    },
  };
  try {
    const { explainCommandWithWriter } = await import("../src/cli/explain.js");
    await explainCommandWithWriter({ artifactDir }, stdout);
  } finally {
    vi.doUnmock("../src/config.js");
    vi.doUnmock("../src/adapters/index.js");
    vi.resetModules();
  }

  expect(explain).toHaveBeenCalledWith(
    expect.objectContaining({
      artifactDir,
      cwd: tempDir,
      sessionId: "ses_123",
      questions: [
        expect.objectContaining({
          question: "Why did you skip SKILL.md?",
        }),
      ],
    }),
  );
  expect(output.join("")).toContain("skillgym");
  expect(output.join("")).toContain("Question 1");
  expect(output.join("")).toContain("Why did you skip SKILL.md?");
  expect(output.join("")).toContain("Agent");
  expect(output.join("")).toContain("Because the prompt looked sufficient.");
  expect(output.join("")).toContain("Saved explanations");

  const explanations = JSON.parse(
    await readFile(path.join(artifactDir, "explanations.json"), "utf8"),
  ) as {
    sessionId: string;
    questions: Array<{ answer: string; sessionId?: string; rawArtifacts: { stdoutPath?: string } }>;
  };
  expect(explanations.sessionId).toBe("ses_123");
  expect(explanations.questions).toEqual([
    expect.objectContaining({
      answer: "Because the prompt looked sufficient.",
      sessionId: "ses_123",
      rawArtifacts: expect.objectContaining({
        stdoutPath: path.join(artifactDir, "explain", "question-01", "stdout.log"),
      }),
    }),
  ]);
});

test("explainCommand reuses existing explanations.json by default", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-cli-"));
  tempDirs.push(tempDir);
  const artifactDir = path.join(tempDir, "alpha", "open-main", "repeat-1");
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, "explanations.json"),
    `${JSON.stringify({
      suitePath: path.join(tempDir, "suite.ts"),
      caseId: "alpha",
      runnerId: "open-main",
      cwd: tempDir,
      sessionId: "ses_123",
      createdAt: "2026-05-07T10:00:02.000Z",
      questions: [
        {
          question: "Why did you skip SKILL.md?",
          source: { filePath: path.join(tempDir, "suite.ts"), line: "12", column: "5" },
          answer: "Because the prompt looked sufficient.",
          sessionId: "ses_123",
          rawArtifacts: {},
        },
      ],
    })}\n`,
    "utf8",
  );

  vi.resetModules();
  const { explainCommandWithWriter } = await import("../src/cli/explain.js");
  const output: string[] = [];
  const stdout = {
    isTTY: false,
    write(value: string) {
      output.push(value);
      return true;
    },
  };

  await explainCommandWithWriter({ artifactDir }, stdout);

  expect(output.join("")).toContain("Reusing existing explanations artifact");
  expect(output.join("")).toContain("Pass --rerun to refresh it.");
  expect(output.join("")).toContain("Because the prompt looked sufficient.");
  expect(output.join("")).toContain("Saved explanations");
});

test("explainCommand reruns and overwrites an existing explanations.json artifact", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-cli-"));
  tempDirs.push(tempDir);
  const artifactDir = path.join(tempDir, "alpha", "open-main", "repeat-1");
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, "report.json"),
    `${JSON.stringify({
      runner: {
        id: "open-main",
        pathKey: "open-main",
        agent: { type: "opencode", model: "openai/gpt-5" },
      },
      prompt: "prompt",
      usage: {
        inputChars: 0,
        outputChars: 0,
        reasoningChars: 0,
        source: { input: "chars", output: "chars", reasoning: "chars" },
      },
      files: { observedReads: [], observedSkillReads: [] },
      detectedSkills: [],
      events: [],
      finalOutput: "",
      rawArtifacts: {},
    })}\n`,
    "utf8",
  );
  await writeFile(
    path.join(artifactDir, "explain.json"),
    `${JSON.stringify({
      suitePath: path.join(tempDir, "suite.ts"),
      caseId: "alpha",
      runnerId: "open-main",
      cwd: tempDir,
      sessionId: "ses_123",
      questions: [
        {
          question: "Why did you skip SKILL.md?",
          source: { filePath: path.join(tempDir, "suite.ts"), line: "12", column: "5" },
        },
      ],
    })}\n`,
    "utf8",
  );
  await writeFile(path.join(artifactDir, "explanations.json"), '{"questions":[]}\n', "utf8");

  const explain = vi.fn(async () => ({
    answers: [
      {
        question: {
          question: "Why did you skip SKILL.md?",
          source: { filePath: path.join(tempDir, "suite.ts"), line: "12", column: "5" },
        },
        answer: "Fresh answer from rerun.",
        sessionId: "ses_123",
        startedAt: "2026-05-07T10:00:00.000Z",
        endedAt: "2026-05-07T10:00:01.000Z",
        durationMs: 1_000,
        rawArtifacts: {},
      },
    ],
  }));

  vi.resetModules();
  vi.doMock("../src/config.js", () => ({
    loadConfig: vi.fn(async () => ({
      config: {
        runners: {
          "open-main": { agent: { type: "opencode", model: "openai/gpt-5" } },
        },
      },
    })),
  }));
  vi.doMock("../src/adapters/index.js", () => ({
    getAdapter: vi.fn(() => ({
      run: vi.fn(),
      collect: vi.fn(),
      normalize: vi.fn(),
      explain,
    })),
  }));

  const output: string[] = [];
  const stdout = {
    isTTY: false,
    write(value: string) {
      output.push(value);
      return true;
    },
  };
  try {
    const { explainCommandWithWriter } = await import("../src/cli/explain.js");
    await explainCommandWithWriter({ artifactDir, rerun: true }, stdout);
  } finally {
    vi.doUnmock("../src/config.js");
    vi.doUnmock("../src/adapters/index.js");
    vi.resetModules();
  }

  expect(explain).toHaveBeenCalledOnce();
  expect(output.join("")).toContain(
    "Re-running explain and overwriting existing explanations artifact.",
  );
  expect(output.join("")).toContain("Fresh answer from rerun.");

  const explanations = JSON.parse(
    await readFile(path.join(artifactDir, "explanations.json"), "utf8"),
  ) as { questions: Array<{ answer: string }> };
  expect(explanations.questions[0]?.answer).toBe("Fresh answer from rerun.");
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
    resolveRunOptions: vi.fn(() => ({
      cwd: tempDir,
      outputDir: path.join(tempDir, ".skillgym-results"),
      schedule: "serial",
      tags: [],
    })),
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
      cases: [
        {
          caseId: "alpha",
          tags: [],
          passed: false,
          runnerResults: [{ passed: false, status: "failed" }],
        },
      ],
      runners: [],
    })),
  }));

  const { RunFailuresError, runCommand } = await import("../src/cli/run.js");

  await expect(runCommand({ suitePath: "./suite.ts", cwd: tempDir })).rejects.toBeInstanceOf(
    RunFailuresError,
  );

  vi.doUnmock("../src/config.js");
  vi.doUnmock("../src/reporters/index.js");
  vi.doUnmock("../src/snapshots/store.js");
  vi.doUnmock("../src/runner/load-suite.js");
  vi.doUnmock("../src/runner/workspace.js");
  vi.doUnmock("../src/runner/execute-suite.js");
});

test("cli run treats expected assertion failures as successful suite health", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-cli-"));
  tempDirs.push(tempDir);
  const { runCommand } = await importRunCommandWithSuiteResult(tempDir, {
    suitePath: path.join(tempDir, "suite.ts"),
    startedAt: "2026-04-02T12:00:00.000Z",
    endedAt: "2026-04-02T12:00:01.000Z",
    durationMs: 1_000,
    outputDir: path.join(tempDir, ".skillgym-results", "run-1"),
    declaredTags: [],
    selectedTags: [],
    cases: [
      {
        caseId: "alpha",
        tags: [],
        passed: true,
        runnerResults: [{ passed: true, status: "expected-failed" }],
      },
    ],
    runners: [],
  });

  await expect(runCommand({ suitePath: "./suite.ts", cwd: tempDir })).resolves.toBeUndefined();

  unmockRunCommandDependencies();
});

test("cli run exits non-zero for unexpected passes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-cli-"));
  tempDirs.push(tempDir);
  const { RunFailuresError, runCommand } = await importRunCommandWithSuiteResult(tempDir, {
    suitePath: path.join(tempDir, "suite.ts"),
    startedAt: "2026-04-02T12:00:00.000Z",
    endedAt: "2026-04-02T12:00:01.000Z",
    durationMs: 1_000,
    outputDir: path.join(tempDir, ".skillgym-results", "run-1"),
    declaredTags: [],
    selectedTags: [],
    cases: [
      {
        caseId: "alpha",
        tags: [],
        passed: false,
        runnerResults: [{ passed: false, status: "unexpected-passed" }],
      },
    ],
    runners: [],
  });

  await expect(runCommand({ suitePath: "./suite.ts", cwd: tempDir })).rejects.toBeInstanceOf(
    RunFailuresError,
  );

  unmockRunCommandDependencies();
});

async function importRunCommandWithSuiteResult(tempDir: string, suiteResult: unknown) {
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
    resolveRunOptions: vi.fn((options) => ({
      cwd: tempDir,
      outputDir: path.join(tempDir, ".skillgym-results"),
      schedule: "serial",
      tags: options.tags,
    })),
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
  vi.doMock("../src/runner/execute-suite.js", () => ({
    executeSuite: vi.fn(async () => suiteResult),
  }));

  return import("../src/cli/run.js");
}

function unmockRunCommandDependencies(): void {
  vi.doUnmock("../src/config.js");
  vi.doUnmock("../src/reporters/index.js");
  vi.doUnmock("../src/snapshots/store.js");
  vi.doUnmock("../src/runner/load-suite.js");
  vi.doUnmock("../src/runner/workspace.js");
  vi.doUnmock("../src/runner/execute-suite.js");
}

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
    cases: [
      {
        caseId: "alpha",
        tags: ["smoke"],
        passed: true,
        runnerResults: [{ passed: true, status: "passed" }],
      },
    ],
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
    resolveRunOptions: vi.fn((options) => ({
      cwd: tempDir,
      outputDir: path.join(tempDir, ".skillgym-results"),
      schedule: "serial",
      tags: options.tags,
    })),
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

  await runCommand({
    suitePath: "./suite.ts",
    cwd: tempDir,
    tags: ["smoke", "gestures", "regression"],
  });

  expect(executeSuite).toHaveBeenCalledWith(
    "./suite.ts",
    expect.any(Array),
    expect.objectContaining({
      tags: ["smoke", "gestures", "regression"],
    }),
  );

  unmockRunCommandDependencies();
});

test("cli run passes retryFailed through to execution", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skillgym-cli-"));
  tempDirs.push(tempDir);
  const executeSuite = vi.fn(async () => ({
    suitePath: path.join(tempDir, "suite.ts"),
    startedAt: "2026-04-02T12:00:00.000Z",
    endedAt: "2026-04-02T12:00:01.000Z",
    durationMs: 1_000,
    outputDir: path.join(tempDir, ".skillgym-results", "run-1"),
    declaredTags: [],
    selectedTags: [],
    cases: [
      {
        caseId: "alpha",
        tags: [],
        passed: true,
        runnerResults: [{ passed: true, status: "passed" }],
      },
    ],
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
    resolveRunOptions: vi.fn((options) => ({
      cwd: tempDir,
      outputDir: path.join(tempDir, ".skillgym-results"),
      schedule: "serial",
      retryFailed: Number(options.retryFailed ?? 0),
      tags: options.tags,
    })),
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
  vi.doMock("../src/runner/execute-suite.js", () => ({
    executeSuite,
  }));

  const { runCommand } = await import("../src/cli/run.js");

  await expect(
    runCommand({ suitePath: "./suite.ts", cwd: tempDir, retryFailed: "2" }),
  ).resolves.toBeUndefined();
  expect(executeSuite).toHaveBeenCalledWith(
    "./suite.ts",
    expect.any(Array),
    expect.objectContaining({ retryFailed: 2 }),
  );

  unmockRunCommandDependencies();
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
