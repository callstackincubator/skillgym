# Changesets

This folder stores changesets — short Markdown files describing changes to be included in the next release.

## Creating a changeset

```bash
pnpm changeset
```

Follow the interactive prompts to select the bump type (patch / minor / major) and write a summary of the change. Commit the generated `.md` file alongside your code changes.

## Releasing

Releases are triggered manually via the **Release** GitHub Actions workflow, which:

1. Runs `changeset version` to consume pending changeset files, bump the package version, and update `CHANGELOG.md`.
2. Commits the changes as `chore: release vX.Y.Z` and pushes a matching git tag.
3. Publishes to npm with provenance attestation.
4. Creates a GitHub Release with the changelog for that version.
