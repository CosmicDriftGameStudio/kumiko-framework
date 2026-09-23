#!/usr/bin/env sh
# Pre-push hook — runs scoped `bun check` before allowing push.
#
# Logic:
#   1. If running inside a worktree with a tracked, executable
#      scripts/check-wt.sh, delegate to it.
#   2. Else if running inside a worktree under the parent workspace (no
#      check-wt.sh), run this worktree's own package.json scripts
#      (typecheck, lint, test, test:dom) directly — the parent's
#      `bun check` would otherwise check the main checkout instead of the
#      worktree.
#   3. Else if running inside the cosmicdriftgamestudio Parent-Workspace,
#      delegate to its `bun check` with KUMIKO_CLI_SCOPE set to THIS
#      sub-repo only — so a push from one sub-repo doesn't run
#      Biome/TS/Tests for its siblings as well.
#   4. Else (standalone clone outside the parent workspace): run the
#      sub-repo's own package.json `test` script — refuses the push if that
#      script is missing.
#
# Extension point: a tracked, executable scripts/pre-push-extra.sh runs
# before the main check in every branch above, with KUMIKO_PUSH_REPO_ROOT
# and KUMIKO_PUSH_PARENT_DIR available inline (never exported).
#
# Override: set PRE_PUSH_SKIP=1 to bypass (use sparingly).

if [ "${PRE_PUSH_SKIP:-0}" = "1" ]; then
  echo "[pre-push] PRE_PUSH_SKIP=1 — hook skipped"
  exit 0
fi

# Git exports GIT_DIR & co. to hooks; nothing this hook starts may inherit them,
# or a test's fixture git calls write into this repo.
LOCAL_GIT_ENV="$(git rev-parse --local-env-vars)" || { echo "[pre-push] FATAL: git rev-parse --local-env-vars failed" >&2; exit 1; }
# shellcheck disable=SC2086
unset $LOCAL_GIT_ENV

REPO_ROOT="$(git rev-parse --show-toplevel)"
if [ -z "$REPO_ROOT" ]; then
  echo "[pre-push] FATAL: git rev-parse --show-toplevel failed — refusing push" >&2
  exit 1
fi
# --git-common-dir resolves to the main checkout's .git dir even when
# REPO_ROOT is a `.wt/<name>` worktree, so REPO_NAME stays the repo's
# own name instead of the worktree directory name.
# Empty result (old git without --path-format, or rev-parse failure) would
# make basename/dirname yield ".", fail-open-scoping the push — refuse instead.
GIT_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [ -z "$GIT_COMMON_DIR" ]; then
  echo "[pre-push] FATAL: git rev-parse --git-common-dir failed — refusing push (would scope as '.')" >&2
  exit 1
fi
REPO_NAME="$(basename "$(dirname "$GIT_COMMON_DIR")")"
if [ -z "$REPO_NAME" ] || [ "$REPO_NAME" = "." ] || [ "$REPO_NAME" = "/" ]; then
  echo "[pre-push] FATAL: could not derive REPO_NAME from git-common-dir='$GIT_COMMON_DIR' — refusing push" >&2
  exit 1
fi

# Walk up from REPO_ROOT looking for the parent workspace's package.json —
# a `.wt/<name>` worktree sits one level deeper than a regular checkout.
PARENT_DIR=""
DIR="$(dirname "$REPO_ROOT")"
while [ "$DIR" != "/" ]; do
  if [ -f "$DIR/package.json" ] \
     && grep -q '"name": *"cosmicdriftgamestudio"' "$DIR/package.json" 2>/dev/null; then
    PARENT_DIR="$DIR"
    break
  fi
  DIR="$(dirname "$DIR")"
done

# Exit 0 iff $REPO_ROOT/package.json has a string scripts[NAME]. Runs from /
# so the repo's bunfig (e.g. a throwing top-level preload) can't turn the
# probe into a false "no script"; path and name go in as argv, never
# interpolated into the JS source.
has_package_script() {
  (cd / && bun -e '
    const pkg = await Bun.file(process.argv[1]).json().catch(() => null);
    const name = process.argv[2];
    process.exit(pkg && typeof pkg.scripts?.[name] === "string" ? 0 : 1);
  ' "$REPO_ROOT/package.json" "$1") >/dev/null 2>&1
}

if git -C "$REPO_ROOT" ls-files --error-unmatch scripts/pre-push-extra.sh >/dev/null 2>&1 \
   && [ -x "$REPO_ROOT/scripts/pre-push-extra.sh" ]; then
  echo "[pre-push] running scripts/pre-push-extra.sh…"
  (cd "$REPO_ROOT" && KUMIKO_PUSH_REPO_ROOT="$REPO_ROOT" KUMIKO_PUSH_PARENT_DIR="$PARENT_DIR" "$REPO_ROOT/scripts/pre-push-extra.sh" "$@") || exit 1
fi

# infra#559/#569: from a worktree, `--git-common-dir` resolves to the main
# checkout's .git, so the branch below would scope `bun check` to the
# canonical sibling path instead of this worktree — checking the wrong
# code. Run the worktree-local check only when scripts/check-wt.sh is
# tracked and executable (untracked/symlink stubs must not hijack push).
if [ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ] \
   && git -C "$REPO_ROOT" ls-files --error-unmatch scripts/check-wt.sh >/dev/null 2>&1 \
   && [ -x "$REPO_ROOT/scripts/check-wt.sh" ]; then
  echo "[pre-push] worktree detected — worktree check (see scripts/check-wt.sh)…"
  cd "$REPO_ROOT" && exec "$REPO_ROOT/scripts/check-wt.sh"
fi

# infra#899: no tracked scripts/check-wt.sh — the parent-scoped `bun check`
# branch below would check the main checkout, not this worktree. Run the
# worktree's own package.json scripts directly instead (only when nested
# under the parent workspace; a standalone worktree's own `bun run test`
# already checks the right code).
if [ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ] \
   && [ -n "$PARENT_DIR" ]; then
  cd "$REPO_ROOT"
  echo "[pre-push] worktree without scripts/check-wt.sh — running this worktree's package.json scripts (typecheck, lint, test, test:dom)…"
  if ! has_package_script test; then
    echo "[pre-push] FATAL: worktree without a package.json \"test\" script — nothing to run, refusing push." >&2
    echo "Add a \"test\" script to package.json, or set PRE_PUSH_SKIP=1 to bypass (use sparingly)." >&2
    exit 1
  fi
  FAILED=""
  for SCRIPT_NAME in typecheck lint test test:dom; do
    if has_package_script "$SCRIPT_NAME"; then
      echo "[pre-push] bun run $SCRIPT_NAME"
      if ! bun run "$SCRIPT_NAME"; then
        FAILED="$FAILED $SCRIPT_NAME"
      fi
    else
      echo "[pre-push] $SCRIPT_NAME: no script, skipped"
    fi
  done
  if [ -n "$FAILED" ]; then
    echo "[pre-push] worktree check failed:$FAILED" >&2
    exit 1
  fi
  exit 0
fi

if [ -n "$PARENT_DIR" ]; then
  echo "[pre-push] bun check (scoped: $REPO_NAME)…"
  # KUMIKO_PUSH_REPO_ROOT forwards this checkout to guards that need it
  # (worktrees never reach this branch — check-wt.sh or the generic
  # worktree branch above always exits first).
  cd "$PARENT_DIR" && KUMIKO_CLI_SCOPE="$REPO_NAME" KUMIKO_PUSH_REPO_ROOT="$REPO_ROOT" bun kumiko-framework/bin/kumiko.ts check
else
  echo "[pre-push] bun run test (standalone)…"
  # `bun test` globs everything the default bunfig doesn't exclude, including
  # integration tests; the package.json `test` script carries the repo's own
  # exclusions (e.g. integration suites needing infra this hook doesn't have).
  # A missing `test` script would otherwise surface as bun's unhelpful
  # "Script not found" — check it up front with a clear, actionable message.
  if ! has_package_script test; then
    echo "[pre-push] FATAL: standalone clone without a package.json \"test\" script — nothing to run, refusing push." >&2
    echo "Add a \"test\" script to package.json, or set PRE_PUSH_SKIP=1 to bypass (use sparingly)." >&2
    exit 1
  fi
  cd "$REPO_ROOT" && bun run test
fi
