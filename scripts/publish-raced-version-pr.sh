#!/usr/bin/env bash
# Rescue-publish's pending-changesets branch used to just skip (kumiko-framework
# #2785): correct when $GITHUB_SHA itself carries unreleased changesets, but
# wrong when $GITHUB_SHA IS the just-merged changeset PR that landed on top of
# the still-open version PR — that version PR's computed versions then never
# reach npm. This script finds that raced version PR, verifies it is really
# the same tree the versions were computed for, and publishes from its own
# head commit. Every verification failure falls through to the ordinary skip
# (released=false, exit 0) — it never publishes anything it could not verify.
set -uo pipefail

: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

skip() {
  echo "::warning::$1"
  echo "released=false" >> "$GITHUB_OUTPUT"
  exit 0
}

# --- 1. find the raced version PR merged onto this exact SHA ---------------
pulls_json="$(gh api "repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}/pulls" 2>/dev/null)" \
  || skip "Pending changesets at ${GITHUB_SHA}, and the PR lookup for a raced version-PR failed. Skipping the rescue publish; a fresh changeset-release/main PR will supersede it (kumiko-framework#2785)."

head_sha="$(echo "$pulls_json" | jq -r --arg repo "$GITHUB_REPOSITORY" '
  [.[] | select(.head.ref == "changeset-release/main"
    and .base.ref == "main"
    and .merged_at != null
    and .head.repo.full_name == $repo)][0].head.sha // empty
')"

if [ -z "$head_sha" ]; then
  skip "Pending changesets at ${GITHUB_SHA} — the computed versions predate them, and no raced version-PR is associated with this commit. Skipping the rescue publish; a fresh changeset-release/main PR will supersede it (kumiko-framework#2785)."
fi

if ! [[ "$head_sha" =~ ^[0-9a-f]{40}$ ]]; then
  skip "Raced version-PR head_sha has an unexpected shape ($head_sha). Skipping the rescue publish."
fi

# --- 2. fetch that commit ----------------------------------------------------
if ! git fetch --quiet origin "$head_sha" 2>/dev/null; then
  pr_number="$(echo "$pulls_json" | jq -r --arg sha "$head_sha" '[.[] | select(.head.sha == $sha)][0].number // empty')"
  if ! [[ "$pr_number" =~ ^[0-9]+$ ]] || ! git fetch --quiet origin "refs/pull/${pr_number}/head" 2>/dev/null; then
    skip "Could not fetch the raced version-PR head ${head_sha}. Skipping the rescue publish."
  fi
fi

# --- 3. verify ---------------------------------------------------------------
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
verify_reason="$(bash "$script_dir/verify-raced-version-pr.sh" "$head_sha" "$GITHUB_SHA")" \
  || skip "Raced version-PR head ${head_sha} failed verification (${verify_reason}). Skipping the rescue publish."

# publish-with-oidc.sh forces `latest` onto the tree's version, so a late run or
# a re-run after a newer version PR already shipped would move `latest` backward.
raced_version="$(git show "${head_sha}:packages/framework/package.json" 2>/dev/null | jq -r '.version // empty')"
latest_version="$(npm view @cosmicdrift/kumiko-framework dist-tags.latest 2>/dev/null)"
if [ -z "$raced_version" ] || [ -z "$latest_version" ]; then
  skip "Could not compare the raced version-PR version (${raced_version:-?}) with npm latest (${latest_version:-?}). Skipping the rescue publish."
fi
if [ "$latest_version" != "$raced_version" ] \
  && [ "$(printf '%s\n%s\n' "$latest_version" "$raced_version" | sort -V | tail -n1)" = "$latest_version" ]; then
  skip "npm latest ${latest_version} is already newer than the raced version-PR's ${raced_version}. Skipping the rescue publish."
fi

# --- 4. publish from a detached worktree at the verified head ---------------
worktree_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/raced-version-pr"
rm -rf "$worktree_dir"
if ! git worktree add --detach "$worktree_dir" "$head_sha"; then
  skip "git worktree add for the raced version-PR head ${head_sha} failed. Skipping the rescue publish."
fi

(
  cd "$worktree_dir" || exit 1
  bun install --frozen-lockfile
  bash scripts/publish-with-oidc.sh
)
publish_status=$?
git worktree remove --force "$worktree_dir" 2>/dev/null || true
if [ "$publish_status" -ne 0 ]; then
  exit "$publish_status"
fi

new_tags="$(git tag --points-at "$head_sha")"
if [ -n "$new_tags" ]; then
  echo "released=true" >> "$GITHUB_OUTPUT"
  tag_refs="$(printf '%s\n' "$new_tags" | sed 's#^#refs/tags/#')"
  if ! git push origin $tag_refs; then
    flat_tags="$(printf '%s ' "$new_tags")"
    echo "::error::npm publish for the raced version-PR ${head_sha} already succeeded — only the git tag push failed. Push the missing tags manually (see kumiko-framework#1788): $flat_tags"
    exit 1
  fi
else
  echo "released=false" >> "$GITHUB_OUTPUT"
fi
