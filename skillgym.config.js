const config = {
  run: {
    cwd: ".",
    outputDir: "./.skillgym-results",
    reporter: "standard",
    schedule: "parallel",
  },
  defaults: {
    timeoutMs: 120_000,
  },
  runners: {
    "open-main": {
      agent: {
        type: "opencode",
        model: "github-copilot/gpt-5.4-mini",
      },
    },
    "code-main": {
      agent: {
        type: "codex",
        model: "gpt-5",
      },
    },
  },
};

export default config;
