const config = {
  run: {
    cwd: ".",
    outputDir: "./.skillgym-results",
    reporter: "standard",
    schedule: "serial",
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
    "claude-main": {
      agent: {
        type: "claude-code",
        model: "claude-sonnet-4-6",
      },
    },
  },
};

export default config;
