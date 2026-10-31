---
status: reference
verified: 2026-10-31
evidence: "scripts/refuse-stale-version-merge.sh, scripts/verify-version-pr-fresh.sh, .github/workflows/ci.yml (release job)"
---

# Stale Version PR merged: nothing was published

The release job on main fails in the step "Refuse a stale Version PR merge" with:

```text
Stale Version PR merged: Version PR did not consume changesets present on main: .changeset/<name>.md
Nothing was published. Merge any commit to main; its release run opens a fresh Version PR that consumes the leftover changesets.
```

## Cause

Another PR with a changeset reached main after the changesets bot last rebuilt the Version PR, and the Version PR was merged anyway. GitHub still reports it as `CLEAN`, because the two PRs touch different files. The merged Version PR bumped the versions without that changeset, so the guard stops before `changesets/action` and nothing reaches npm.

The guard stops the job before `changesets/action`, so this push does not rebuild the Version PR. An open Version PR stays `DIRTY` against main until the next push to main.

## Recovery

1. Merge any other PR to main, for example a pending fix or a docs change. Docs outside `packages/` need no changeset.
2. Its release run opens a fresh Version PR. That PR consumes the leftover changeset and contains everything that was meant for the refused release.
3. Merge the fresh Version PR once its checks are green. The release job publishes it.

Do not revert the stale merge and do not hand-edit versions. The next Version PR builds on the bumped `package.json` files and on the leftover changesets.

## Before merging a Version PR

Check that it is fresh against the current main:

```bash
git fetch origin
bash scripts/verify-version-pr-fresh.sh origin/changeset-release/main origin/main
```

`ok` means the PR is built on main and consumed every changeset. Anything else names what is missing. In that case wait for the bot to rebuild the PR after the latest push to main.
