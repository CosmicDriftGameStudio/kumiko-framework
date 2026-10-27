#!/usr/bin/env bash
# Framework-only checks that run before the generic pre-push checks
# (typecheck, tests, guards/ui/checks, comment-lang, public-exports-changelog).
# Runs through packages/guards/src/pre-push.sh; `scripts/check-wt.sh` runs the same hook.
# Inside the parent workspace the AST guards and the runtime-isolation check are
# not repeated here: the worktree branch runs them via packages/guards/src/cli.ts
# (guards, checks), the parent-scoped branch via the `kumiko check` step. A
# standalone clone only gets the hook's `bun run test`, so it runs them below.
# The steps run in parallel lanes through packages/guards/src/run-steps-parallel.ts.
set -uo pipefail

# Merge-base against origin/main, not @{u}: after the first push, @{u} points
# at this branch's own remote, which drifts from the diff CI actually checks.
BASE="origin/main"
git rev-parse --verify --quiet "$BASE" >/dev/null || BASE="main"
MERGE_BASE="$(git merge-base "$BASE" HEAD)"

steps=(
  # check:dist packs every published dist package and imports it under Node and
  # Bun (a missing .js in a compiled subpath otherwise only shows up in CI). It
  # stays behind the tsc -b samples pass in one lane: both build package output.
  --step "typecheck samples (CI parity)" "bun scripts/check-app-tsc.ts"
  --then "dist packages (CI parity)" "bun run check:dist"
  --step "biome check" "bunx biome check ."
  --step "package cycles" "bun scripts/check-package-cycles.ts"
  --step "integration mock guard" "bun integration.guard.ts"
  --step "doc screenshot freshness (warn-only)" "bun scripts/check-doc-screenshots-fresh.ts || true"
  --step "changeset required" "BASE_REF=main bash scripts/changeset-required-check.sh"
  --step "changes-json guard (base=$MERGE_BASE)" "GITHUB_BASE_SHA=$MERGE_BASE bun scripts/guard-changes-json.ts"
)

if [ -z "${KUMIKO_PUSH_PARENT_DIR:-}" ]; then
  steps+=(
    --step "AST guards (standalone clone)" "bun packages/guards/src/run-guards.ts"
    --step "runtime isolation (standalone clone)" "bun packages/guards/src/check-runtime-isolation.ts"
  )
fi

exec bun packages/guards/src/run-steps-parallel.ts --fail-prefix "[pre-push-extra] failed:" "${steps[@]}"
