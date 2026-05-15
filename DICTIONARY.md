# SkillGym Dictionary

This is the domain dictionary for `skillgym`.

Use the existing vocabulary in code, docs, tests, issues, and conversations.
Prefer reusing an existing term over inventing a new one.
Before adding or changing a term, check this file and ask the user for approval.

## Terms

- `SkillGym`: The product, package, CLI, and repository.
- `suite file`: Module file that exports one suite.
- `suite`: User-authored collection of cases and optional workspace config.
- `case`: One definition with a prompt, assertions, and optional metadata.
- `prompt`: Exact instruction sent to the agent.
- `runner`: Configured execution target: agent type plus model.
- `agent`: External coding agent doing the work.
- `suite run`: One top-level `skillgym run ...` over one suite.
- `execution`: One case x runner unit of work, including all its repetitions and retries.
- `repetition`: One planned sample within an execution.
- `retry`: Rerunning the same repetition after failure.
- `session`: One concrete agent interaction; not a synonym for `repetition`.
- `session report`: Normalized record of a completed session, exposed to assertions.
- `assertion`: Rule deciding whether a case passed or failed.
- `expected failure`: Assertion failure treated as suite-successful because it captures a known gap.
- `failure classification`: Stable category assigned to a failure.
- `failure class`: The value representing a failure classification.
- `result`: Pass/fail outcome object; not a session report.
- `artifact`: Preserved file or directory written by SkillGym.
- `artifact directory`: Directory holding artifacts for one scope such as a suite run, execution, repetition, retry, or session.
- `workspace`: Directory where the agent runs.
- `no workspace`: Run directly in an existing working directory with no provisioning.
- `shared workspace`: One provisioned workspace created once per suite run and reused across executions.
- `isolated workspace`: Fresh workspace created per execution.
- `workspace template`: Directory copied into an execution workspace before execution.
- `workspace bootstrap`: Command run in a provisioned workspace before the agent starts.
- `schedule`: Execution ordering and concurrency policy.
- `reporter`: Component rendering suite-run progress and results.
- `skill detection`: Evidence that a skill was used, with confidence and evidence.
- `session event`: Normalized event observed during a session.
- `snapshot baseline`: Stored token baseline for a benchmark case x runner pair.
- `token regression check`: Comparison of current token usage against the snapshot baseline.
