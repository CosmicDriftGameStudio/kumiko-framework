#!/usr/bin/env bash
# check-wt.sh — Worktree-local validation. Run from the worktree cwd.
#
#   cd ../kumiko-framework-issue-<n>
#   ./scripts/check-wt.sh
#
# Runs checks that are reliable in a worktree: tsc + sample typecheck + Biome
# + unit tests. These need no cross-repo import resolution and are correct in
# the worktree.
#
# comment-lang scans the cwd directly (no sibling/cross-repo resolution), so
# it is safe to run here scoped to the worktree. The public kumiko-guards
# bundles (guards/ui/checks) are NOT wired in: this repo's own CI does not run
# them (only the private kumiko-guard-no-logic-in-views, unrelated to the
# public bundle), so there is nothing to mirror locally.
set -uo pipefail

echo "── Worktree check · $(pwd) ──"
[ -f tsconfig.json ] || { echo "✗ no tsconfig.json in cwd — are you in the worktree root?"; exit 2; }

fail=0

# Merge-base against origin/main, not @{u}: after the first push, @{u} points
# at this branch's own remote, which drifts from the diff CI actually checks.
BASE="origin/main"
git rev-parse --verify --quiet "$BASE" >/dev/null || BASE="main"
MERGE_BASE="$(git merge-base "$BASE" HEAD)"

echo
echo "→ typecheck (bun run typecheck — repo-owned tsc runs)"
# Root `tsc -b` fails with TS18003 when root tsconfig is include:[] only
# (kumiko-platform#528). The root "typecheck" script builds real projects.
bun run typecheck || fail=1

echo
# samples/apps/** aren't in the root tsc -b references chain (see
# check-app-tsc.ts header), so the step above never touches them. CI runs
# this separately as "TypeScript (framework + samples)" — mirror it here so
# sample type errors surface locally instead of only in CI (#2679).
echo "→ typecheck samples (bun scripts/check-app-tsc.ts — CI parity)"
bun scripts/check-app-tsc.ts || fail=1

echo
echo "→ biome check"
bunx biome check . || fail=1

echo
if [ -e node_modules/.bin/kumiko-guard-comment-lang ]; then
  echo "→ comment-lang guard --touched (base=$MERGE_BASE)"
  bun kumiko-guard-comment-lang --touched --base="$MERGE_BASE" || fail=1
else
  echo "✗ missing guard binary: node_modules/.bin/kumiko-guard-comment-lang — install broken, comment-lang did not run"
  fail=1
fi

echo
echo "→ bun test (unit suite)"
cfg=(); [ -f bunfig.ci.toml ] && cfg=(--config=bunfig.ci.toml)

# Prefer parent-workspace .env (sibling worktree or .wt/<name> layout).
PARENT_ROOT=""
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
while [ "$DIR" != "/" ]; do
  if [ -f "$DIR/package.json" ] \
    && grep -q '"name": *"cosmicdriftgamestudio"' "$DIR/package.json" 2>/dev/null; then
    PARENT_ROOT="$DIR"
    break
  fi
  DIR="$(dirname "$DIR")"
done

env=()
if [ -n "$PARENT_ROOT" ] && [ -f "$PARENT_ROOT/.env" ]; then
  env=(--env-file="$PARENT_ROOT/.env")
elif [ -f ../.env ]; then
  env=(--env-file=../.env)
fi
bun "${cfg[@]}" "${env[@]}" test --dots || fail=1

ran_test_dom=0
if grep -q '"test:dom"' package.json 2>/dev/null; then
  ran_test_dom=1
  echo
  echo "→ bun run test:dom (component tests — not under bunfig.ci.toml)"
  bun run test:dom || fail=1
fi

echo
if [ "$fail" = 0 ] && [ "$ran_test_dom" = 1 ]; then
  echo "✓ Worktree check green — tsc + sample typecheck + Biome + comment-lang --touched + unit tests + component tests."
elif [ "$fail" = 0 ]; then
  echo "✓ Worktree check green — tsc + sample typecheck + Biome + comment-lang --touched + unit tests."
else
  echo "✗ Worktree check red — see above. Do not commit until green."
fi
echo "  guards checked against $MERGE_BASE (merge-base with $BASE)"
exit "$fail"
