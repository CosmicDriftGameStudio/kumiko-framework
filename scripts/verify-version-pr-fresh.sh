#!/usr/bin/env bash
# Pure freshness check for the changesets Version PR: given (head_sha, main_sha),
# confirm head_sha is built on main's current HEAD and consumed every
# changeset main carries. Read-only (no gh, no push), so it cannot loop with the
# changesets bot: the bot rebuilds the branch on every main push, which re-runs
# this check against the new head.
set -uo pipefail

head_sha="${1:?head_sha required}"
main_sha="${2:?main_sha required}"

fail() {
  echo "$1"
  exit 1
}

git merge-base --is-ancestor "$main_sha" "$head_sha" \
  || fail "Version PR is not based on the current main HEAD ($(git rev-parse --short "$main_sha")); wait for the changesets bot to rebuild it"

unconsumed="$(
  git ls-tree -r --name-only "$main_sha" -- .changeset | grep '\.md$' | grep -v '/README\.md$' \
    | while read -r path; do
        git cat-file -e "${head_sha}:${path}" 2>/dev/null && echo "$path"
      done
)"
[ -z "$unconsumed" ] || fail "Version PR did not consume changesets present on main: $(echo "$unconsumed" | tr '\n' ' ')"

echo "ok"
