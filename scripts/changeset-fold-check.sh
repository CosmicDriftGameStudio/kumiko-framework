#!/usr/bin/env bash
# PR-side counterpart to changeset-version.sh: the same status+fold pair the
# release runs, minus the writing. Without it a changeset with an unresolvable
# `feature:` stays green in its own PR and then breaks every following release.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "$(find .changeset -maxdepth 1 -name '*.md' ! -name 'README.md' -print -quit)" ]; then
  echo "No changesets to fold."
  exit 0
fi

# `changeset status` resolves config.baseBranch as a local ref, but the
# pull_request checkout is detached and carries main only as refs/remotes.
git show-ref --verify --quiet refs/heads/main || git branch main origin/main

# Outside the repo, so the dry run cannot leave anything in the diff.
bump_status="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/changeset-status.XXXXXX")"
trap 'rm -f "$bump_status"' EXIT

bunx changeset status --output="$bump_status"
bun bin/kumiko.ts changes fold --status "$bump_status" --dry-run
