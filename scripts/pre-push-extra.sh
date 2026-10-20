#!/usr/bin/env bash
# Framework-only checks that run before the generic pre-push checks
# (typecheck, tests, comment-lang, public-exports-changelog).
# Runs through packages/guards/src/pre-push.sh; `scripts/check-wt.sh` runs the same hook.
set -uo pipefail

fail=0

# Merge-base against origin/main, not @{u}: after the first push, @{u} points
# at this branch's own remote, which drifts from the diff CI actually checks.
BASE="origin/main"
git rev-parse --verify --quiet "$BASE" >/dev/null || BASE="main"
MERGE_BASE="$(git merge-base "$BASE" HEAD)"

echo "→ typecheck samples (bun scripts/check-app-tsc.ts — CI parity)"
bun scripts/check-app-tsc.ts || fail=1

echo "→ biome check"
bunx biome check . || fail=1

echo "→ AST guards (bun packages/guards/src/run-guards.ts — CI entry runGuardsCli)"
bun packages/guards/src/run-guards.ts || fail=1

echo "→ Runtime isolation (bun packages/guards/src/check-runtime-isolation.ts)"
bun packages/guards/src/check-runtime-isolation.ts || fail=1

echo "→ Package cycles (bun scripts/check-package-cycles.ts)"
bun scripts/check-package-cycles.ts || fail=1

echo "→ integration mock guard (bun integration.guard.ts)"
bun integration.guard.ts || fail=1

echo "→ doc screenshot freshness (warn-only)"
bun scripts/check-doc-screenshots-fresh.ts || true

echo "→ changeset required (scripts/changeset-required-check.sh, BASE_REF=main)"
BASE_REF=main bash scripts/changeset-required-check.sh || fail=1

echo "→ changes-json guard (base=$MERGE_BASE)"
GITHUB_BASE_SHA="$MERGE_BASE" bun scripts/guard-changes-json.ts || fail=1

# Packs and imports every published dist package under Node and Bun; a missing
# .js in a compiled subpath otherwise only shows up in CI.
echo "→ dist packages (bun run check:dist — CI parity)"
bun run check:dist || fail=1

exit "$fail"
