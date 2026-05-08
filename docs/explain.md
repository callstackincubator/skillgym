# Deferred Explain

`skillgym explain <artifactDir>` resumes a failed run's original runner session and asks persisted follow-up questions.

## Required input

Point the command at a direct repetition or attempt artifact directory, for example:

```bash
skillgym explain ./.skillgym-results/run-1/case-a/open-main/repeat-1
skillgym explain ./.skillgym-results/run-1/case-a/open-main/repeat-2/attempt-2
```

The directory must contain:

- `report.json`
- `explain.json`

If `explanations.json` already exists, the command refuses to run again.

## Generated files

### `explain.json`

Created automatically for failed runs when at least one explainable assertion question exists.

Shape:

```json
{
  "suitePath": "/abs/path/to/suite.ts",
  "caseId": "skill-selection",
  "runnerId": "open-main",
  "cwd": "/abs/path/to/workspace",
  "sessionId": "ses_123",
  "questions": [
    {
      "question": "Why did you proceed without reading SKILL.md?",
      "source": {
        "filePath": "/abs/path/to/suite.ts",
        "line": "14",
        "column": "15"
      }
    }
  ]
}
```

### `explanations.json`

Created only by `skillgym explain`.

Shape:

```json
{
  "suitePath": "/abs/path/to/suite.ts",
  "caseId": "skill-selection",
  "runnerId": "open-main",
  "cwd": "/abs/path/to/workspace",
  "sessionId": "ses_123",
  "createdAt": "2026-05-08T12:00:00.000Z",
  "questions": [
    {
      "question": "Why did you proceed without reading SKILL.md?",
      "source": {
        "filePath": "/abs/path/to/suite.ts",
        "line": "14",
        "column": "15"
      },
      "answer": "I inferred the task from the prompt and skipped the read.",
      "sessionId": "ses_123",
      "startedAt": "2026-05-08T12:00:01.000Z",
      "endedAt": "2026-05-08T12:00:04.000Z",
      "durationMs": 3000,
      "rawArtifacts": {
        "stdoutPath": "/abs/path/to/stdout.log",
        "stderrPath": "/abs/path/to/stderr.log",
        "exportPath": "/abs/path/to/session.export.json"
      }
    }
  ]
}
```

## Runner support

Deferred explain is implemented for:

- OpenCode
- Codex
- Claude Code
- Cursor Agent

Each runner must have a resumable session id captured during the original run.

## Current caveat

Deferred explain currently assumes the recorded `cwd` is still resumable by the runner.

For isolated workspaces, that means historical explain attempts may fail if the original workspace was already cleaned up and the runner needs that exact workspace state to resume correctly.
