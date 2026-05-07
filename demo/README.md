# SkillGym Demo Suites

This directory contains small focused demo suites for presenting one SkillGym feature per file.

## Suggested run order

1. `basic-output.ts`
2. `skill-selection.ts`
3. `command-matching.ts`
4. `file-reads.ts`
5. `tool-call-sequence.ts`
6. `soft-assertions.ts`
7. `shared-workspace.ts`
8. `isolated-workspace.ts`
9. `cross-runner.ts`
10. `snapshot-baseline.ts`
11. `expected-failure.ts`
12. `failure-classification.ts`

## Example commands

```bash
pnpm exec tsx ./index.ts run ./demo/basic-output.ts
pnpm exec tsx ./index.ts run ./demo/cross-runner.ts --runner open-main
pnpm exec tsx ./index.ts run ./demo/cross-runner.ts --runner codex-main
pnpm exec tsx ./index.ts run ./demo/snapshot-baseline.ts --update-snapshots
pnpm exec tsx ./index.ts run ./demo/basic-output.ts --reporter json-summary
```

## Notes

- `expected-failure.ts` is designed to produce `expected-failed` status.
- `failure-classification.ts` is designed to fail so grouped failure reporting is visible.
- `isolated-workspace.ts` uses `demo/isolated-workspace-template` and `demo/workspace-bootstrap.sh`.
