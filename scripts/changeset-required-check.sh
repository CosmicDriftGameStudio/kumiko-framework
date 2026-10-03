#!/usr/bin/env bash
# PR-side gate: a PR that touches a publishable package's source but carries no
# changeset stays green today and only breaks the release that folds it in
# (guard-changes-json catches malformed changesets, not missing ones).
set -euo pipefail

cd "$(dirname "$0")/.."

: "${BASE_REF:?BASE_REF is required}"
if ! [[ "$BASE_REF" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "::error::BASE_REF has an unexpected shape: $BASE_REF"
  exit 1
fi

# Branches that never carry a changeset of their own: the release PR itself
# and dependency bumps. HEAD_REF is CI's PR head (the checkout there is a merge
# commit, so the current branch name is useless); locally the checked-out branch.
HEAD_REF="${HEAD_REF:-$(git rev-parse --abbrev-ref HEAD)}"
if ! [[ "$HEAD_REF" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "::error::HEAD_REF has an unexpected shape: $HEAD_REF"
  exit 1
fi
case "$HEAD_REF" in
  changeset-release/main | renovate/*)
    echo "changeset-required-check: skipped for branch $HEAD_REF"
    exit 0
    ;;
esac

# Consumer repos have no changesets setup; nothing to require.
if [ ! -f .changeset/config.json ]; then
  echo "changeset-required-check: no .changeset/config.json — skipped"
  exit 0
fi

# `changeset status` resolves config.baseBranch ("main") as a local ref
# regardless of --since, same as changeset-fold-check.sh.
git show-ref --verify --quiet refs/heads/main || git branch main origin/main

if bunx changeset status --since="origin/${BASE_REF}"; then
  exit 0
fi

changed_packages="$(
  git diff --name-only "origin/${BASE_REF}...HEAD" -- packages/ \
    | sed -E 's#^(packages/[^/]+)/.*#\1#' \
    | sort -u \
    | while IFS= read -r dir; do
        [ -f "$dir/package.json" ] || continue
        grep -m1 '"name"' "$dir/package.json" | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
      done
)"

# Empty list means `changeset status` failed for another reason (config error,
# missing ref, broken changeset file); its output above is the real cause.
if [ -z "$changed_packages" ]; then
  echo "::error::changeset status failed; see its output above"
  exit 1
fi

echo "::error::No changeset found for changed package(s): $(echo "$changed_packages" | paste -sd, -). Run 'bun changeset' (or 'bun changeset --empty' if this change needs no release)."
exit 1
