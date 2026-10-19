#!/usr/bin/env bash
# check-wt.sh — the pre-push hook run on demand from the worktree root.
#
#   cd .wt/<name>
#   ./scripts/check-wt.sh
#
# One form: the full hook (packages/guards/src/pre-push.sh) plus this repo's
# extras from scripts/pre-push-extra.sh, which the hook runs first. The hook
# does not re-enter this script when KUMIKO_CHECK_WT=1.
set -uo pipefail

[ -f tsconfig.json ] || { echo "✗ no tsconfig.json in cwd — are you in the worktree root?"; exit 2; }

exec env KUMIKO_CHECK_WT=1 packages/guards/src/pre-push.sh
