#!/usr/bin/env bash
# check-wt.sh — Worktree-local validation. Run from the worktree cwd.
#
#   cd ../kumiko-framework-issue-<n>
#   ./scripts/check-wt.sh
#
# Runs checks that are reliable in a worktree: tsc + Biome + unit tests.
# These need no cross-repo import resolution and are correct in the worktree.
#
# Import-resolving guards (runtime isolation etc.) intentionally do NOT run
# here: worktree node_modules symlinks point at main → cross-repo targets get
# misclassified. Guards run reliably in PR CI (real merge, correct node_modules).
set -uo pipefail

echo "── Worktree check · $(pwd) ──"
[ -f tsconfig.json ] || { echo "✗ no tsconfig.json in cwd — are you in the worktree root?"; exit 2; }

fail=0

echo
echo "→ typecheck (bun run typecheck — repo-owned tsc runs)"
# Root `tsc -b` fails with TS18003 when root tsconfig is include:[] only
# (kumiko-platform#528). The root "typecheck" script builds real projects.
bun run typecheck || fail=1

echo
echo "→ biome check"
bunx biome check . || fail=1

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
  echo "✓ Worktree check green — tsc + Biome + unit tests + component tests. (Guards run in PR CI.)"
elif [ "$fail" = 0 ]; then
  echo "✓ Worktree check green — tsc + Biome + unit tests. (Guards run in PR CI.)"
else
  echo "✗ Worktree check red — see above. Do not commit until green."
fi
exit "$fail"
