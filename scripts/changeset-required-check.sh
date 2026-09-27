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

echo "::error::No changeset found for changed package(s): $(echo "$changed_packages" | paste -sd, -). Run 'bun changeset' (or 'bun changeset --empty' if this change needs no release)."
exit 1
