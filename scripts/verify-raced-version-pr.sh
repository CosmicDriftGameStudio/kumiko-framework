#!/usr/bin/env bash
# Pure verification for publish-raced-version-pr.sh: given (head_sha, target_sha),
# confirm head_sha is a single-parent commit whose parent is an ancestor of
# target_sha, whose patch is identical to target_sha's (rebase/squash both
# preserve this), and whose tree carries no pending changesets. No gh/npm —
# runs against any git repo, so it is unit-testable against a throwaway one.
set -uo pipefail

head_sha="${1:?head_sha required}"
target_sha="${2:?target_sha required}"

fail() {
  echo "$1"
  exit 1
}

parent_count="$(git rev-list --parents -n1 "$head_sha" 2>/dev/null | awk '{print NF}')"
[ "$parent_count" = "2" ] || fail "not a single-parent commit"

git merge-base --is-ancestor "${head_sha}^" "$target_sha" || fail "parent is not an ancestor of $target_sha"

patch_id_head="$(git show "$head_sha" | git patch-id --stable | awk '{print $1}')"
patch_id_target="$(git show "$target_sha" | git patch-id --stable | awk '{print $1}')"
[ -n "$patch_id_head" ] && [ "$patch_id_head" = "$patch_id_target" ] || fail "patch-id mismatch"

pending="$(git ls-tree -r --name-only "$head_sha" -- .changeset 2>/dev/null | grep '\.md$' | grep -v '/README\.md$' || true)"
[ -z "$pending" ] || fail "pending changesets in head tree"

echo "ok"
