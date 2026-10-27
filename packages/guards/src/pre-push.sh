#!/usr/bin/env sh
# Pre-push hook — runs scoped `bun check` before allowing push.
#
# Logic:
#   1. If running inside a worktree with a tracked, executable
#      scripts/check-wt.sh, delegate to it.
#   2. Else if running inside a worktree under the parent workspace (no
#      check-wt.sh), run this worktree's own package.json scripts
#      (typecheck, lint, test, test:dom) plus the consumer-CI guards
#      (kumiko-guards guards/ui/checks/comment-lang) directly, in parallel
#      lanes via run-steps-parallel.ts —
#      the parent's `bun check` would otherwise check the main checkout
#      instead of the worktree.
#   3. Else if running inside the cosmicdriftgamestudio Parent-Workspace,
#      delegate to its `bun check` with KUMIKO_CLI_SCOPE set to THIS
#      sub-repo only — so a push from one sub-repo doesn't run
#      Biome/TS/Tests for its siblings as well.
#   4. Else (standalone clone outside the parent workspace): run the
#      sub-repo's own package.json `test` script — refuses the push if that
#      script is missing.
#
# Before the checks below, the hook runs a gitleaks scan of origin/main..<pushed sha>
# for every pushed ref when the binary is installed.
#
# Extension point: a tracked, executable scripts/pre-push-extra.sh runs
# before the main check in every branch above, with KUMIKO_PUSH_REPO_ROOT
# and KUMIKO_PUSH_PARENT_DIR available inline (never exported).
#
# The pre-flight steps (pre-push-extra.sh, upgrade-state guard, gitleaks) run
# once per push: a re-entry from the wrapping check-wt.sh skips them, because
# the outer run already did them before delegating.

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

# Same rule as `kumiko check`: the UI guards run only for declared, non-empty uiRoots.
has_ui_roots() {
  (cd / && bun -e '
    const manifest = await Bun.file(process.argv[1]).json().catch(() => null);
    process.exit(Array.isArray(manifest?.uiRoots) && manifest.uiRoots.length > 0 ? 0 : 1);
  ' "$REPO_ROOT/kumiko.json") >/dev/null 2>&1
}

# Re-entry from the wrapping check-wt.sh is detected by process ancestry: the
# hook records its own PID in KUMIKO_CHECK_WT_OWNER before delegating, so a
# freely exported variable can neither skip the tracked check-wt.sh nor the
# pre-flight steps below.
is_reentry_from_check_wt() {
  reentry_pid=$$
  case "${KUMIKO_CHECK_WT_OWNER:-}" in '' | *[!0-9]*) return 1 ;; esac
  while [ -n "$reentry_pid" ] && [ "$reentry_pid" -gt 1 ]; do
    [ "$reentry_pid" = "$KUMIKO_CHECK_WT_OWNER" ] && return 0
    reentry_pid=$(ps -o ppid= -p "$reentry_pid" 2>/dev/null | tr -d ' ')
  done
  return 1
}

CHECK_WT_REENTRY=0
if is_reentry_from_check_wt; then
  CHECK_WT_REENTRY=1
  echo "[pre-push] re-entered from scripts/check-wt.sh — pre-push-extra.sh, upgrade-state guard and secret scan already ran in the outer hook"
fi

if [ "$CHECK_WT_REENTRY" = 0 ] \
   && git -C "$REPO_ROOT" ls-files --error-unmatch scripts/pre-push-extra.sh >/dev/null 2>&1 \
   && [ -x "$REPO_ROOT/scripts/pre-push-extra.sh" ]; then
  echo "[pre-push] running scripts/pre-push-extra.sh…"
  (cd "$REPO_ROOT" && KUMIKO_PUSH_REPO_ROOT="$REPO_ROOT" KUMIKO_PUSH_PARENT_DIR="$PARENT_DIR" "$REPO_ROOT/scripts/pre-push-extra.sh" "$@") || exit 1
fi

# Upgrade-state guard: a repo that has adopted the `.kumiko/upgrade-state.json`
# marker must not push with it stale. Installed as a bin, `$0` here is the
# node_modules/.bin symlink, not this file's real path — resolve the symlink
# chain so guard-upgrade-state.ts is found next to the real script, not $0.
resolve_script_dir() {
  SOURCE="$1"
  while [ -h "$SOURCE" ]; do
    DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
    SOURCE="$(readlink "$SOURCE")"
    case "$SOURCE" in
      /*) ;;
      *) SOURCE="$DIR/$SOURCE" ;;
    esac
  done
  cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd
}

if [ "$CHECK_WT_REENTRY" = 0 ] && [ -f "$REPO_ROOT/.kumiko/upgrade-state.json" ]; then
  SCRIPT_DIR="$(resolve_script_dir "$0")"
  GUARD_UPGRADE_STATE="$SCRIPT_DIR/guard-upgrade-state.ts"
  if [ ! -f "$GUARD_UPGRADE_STATE" ]; then
    echo "[pre-push] FATAL: guard-upgrade-state.ts not found next to resolved script location '$SCRIPT_DIR' — refusing push" >&2
    exit 1
  fi
  echo "[pre-push] .kumiko/upgrade-state.json present — running upgrade-state guard…"
  if ! (cd "$REPO_ROOT" && bun "$GUARD_UPGRADE_STATE"); then
    echo "[pre-push] upgrade-state guard failed — refusing push" >&2
    exit 1
  fi
fi

# Secret scan: runs before check-wt.sh/bun check so a leaked credential is
# caught in seconds, not after the long checks. A missing binary or a missing
# origin/main only warns, so a machine without gitleaks is not locked out.
# No --config: gitleaks reads a .gitleaks.toml in the repo root itself.
if [ "$CHECK_WT_REENTRY" = 1 ]; then
  : # the outer hook scanned the pushed refs from git's stdin
elif ! command -v gitleaks >/dev/null 2>&1; then
  echo "[pre-push] gitleaks not installed — secret scan skipped. Install: brew install gitleaks" >&2
elif ! git -C "$REPO_ROOT" rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
  echo "[pre-push] origin/main not found — secret scan skipped" >&2
else
  # git passes "<local ref> <local sha> <remote ref> <remote sha>" per pushed ref on stdin;
  # scan those tips (not HEAD), skip deletes. Without stdin (direct call) fall back to HEAD.
  SCAN_TIPS=""
  PUSH_LINES=0
  if [ ! -t 0 ]; then
    while read -r _local_ref LOCAL_SHA _remote_ref _remote_sha; do
      [ -n "$LOCAL_SHA" ] || continue
      PUSH_LINES=$((PUSH_LINES + 1))
      case "$LOCAL_SHA" in *[!0]*) SCAN_TIPS="$SCAN_TIPS $LOCAL_SHA" ;; esac
    done
  fi
  if [ "$PUSH_LINES" -eq 0 ]; then
    SCAN_TIPS=" HEAD"
  fi
  for SCAN_TIP in $SCAN_TIPS; do
    echo "[pre-push] gitleaks git origin/main..$SCAN_TIP"
    if ! (cd "$REPO_ROOT" && gitleaks git --no-banner --redact --log-opts="origin/main..$SCAN_TIP" .); then
      echo "[pre-push] gitleaks found secrets — refusing push" >&2
      exit 1
    fi
  done
fi

# infra#559/#569: from a worktree, `--git-common-dir` resolves to the main
# checkout's .git, so the branch below would scope `bun check` to the
# canonical sibling path instead of this worktree — checking the wrong
# code. Run the worktree-local check only when scripts/check-wt.sh is
# tracked and executable (untracked/symlink stubs must not hijack push).
if [ "$CHECK_WT_REENTRY" = 0 ] \
   && [ "$(git rev-parse --path-format=absolute --git-dir)" != "$GIT_COMMON_DIR" ] \
   && git -C "$REPO_ROOT" ls-files --error-unmatch scripts/check-wt.sh >/dev/null 2>&1 \
   && [ -x "$REPO_ROOT/scripts/check-wt.sh" ]; then
  echo "[pre-push] worktree detected — worktree check (see scripts/check-wt.sh)…"
  cd "$REPO_ROOT" && KUMIKO_CHECK_WT_OWNER=$$ exec "$REPO_ROOT/scripts/check-wt.sh"
fi

# The repo that ships kumiko-guards runs its checked-out cli.ts, so a push checks
# the branch's own guards even when node_modules/.bin resolves to another checkout.
is_kumiko_guards_repo() {
  [ -f "$REPO_ROOT/packages/guards/src/cli.ts" ] \
    && grep -q '"name": *"@cosmicdrift/kumiko-guards"' "$REPO_ROOT/packages/guards/package.json" 2>/dev/null
}

# Runs a guard bin from the worktree's or the parent's node_modules/.bin
# (same guards consumer CI runs); an unresolvable bin is skipped, not fatal.
add_guard_step() {
  GUARD_LABEL="$1"
  GUARD_BIN="$2"
  GUARD_ARGS="$3"
  if [ "$GUARD_BIN" = "kumiko-guards" ] && is_kumiko_guards_repo; then
    add_step --step "$GUARD_LABEL" "bun $(shell_quote "$REPO_ROOT/packages/guards/src/cli.ts") $GUARD_ARGS"
    return 0
  fi
  for GUARD_CANDIDATE in "$REPO_ROOT/node_modules/.bin/$GUARD_BIN" "$PARENT_DIR/node_modules/.bin/$GUARD_BIN"; do
    if [ -x "$GUARD_CANDIDATE" ]; then
      add_step --step "$GUARD_LABEL" "$(shell_quote "$GUARD_CANDIDATE") $GUARD_ARGS"
      return 0
    fi
  done
  echo "[pre-push] $GUARD_BIN: not resolvable in worktree/parent, skipped"
}

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# POSIX sh has no arrays: the runner's argv is collected as one quoted string.
STEP_ARGS=""
add_step() {
  for STEP_ARG in "$@"; do
    STEP_ARGS="$STEP_ARGS $(shell_quote "$STEP_ARG")"
  done
}

# infra#899: no tracked scripts/check-wt.sh — the parent-scoped `bun check`
# branch below would check the main checkout, not this worktree. Run the
# worktree's own package.json scripts directly instead (only when nested
# under the parent workspace; a standalone worktree's own `bun run test`
# already checks the right code).
if [ "$(git rev-parse --path-format=absolute --git-dir)" != "$GIT_COMMON_DIR" ] \
   && [ -n "$PARENT_DIR" ]; then
  cd "$REPO_ROOT"
  echo "[pre-push] worktree without scripts/check-wt.sh — running this worktree's package.json scripts (typecheck, lint, test, test:dom) and guards (guards, ui, checks, comment-lang, public-exports-changelog)…"
  if ! has_package_script test; then
    echo "[pre-push] FATAL: worktree without a package.json \"test\" script — nothing to run, refusing push." >&2
    echo "Add a \"test\" script to package.json." >&2
    exit 1
  fi
  RUNNER="$(resolve_script_dir "$0")/run-steps-parallel.ts"
  if [ ! -f "$RUNNER" ]; then
    echo "[pre-push] FATAL: run-steps-parallel.ts not found next to the resolved hook — refusing push" >&2
    exit 1
  fi
  # test:dom stays behind test (always declared, see above) in one lane: both are
  # bun test runs over the same repo and have always run one after the other.
  for SCRIPT_NAME in typecheck lint test test:dom; do
    STEP_FLAG="--step"
    [ "$SCRIPT_NAME" = "test:dom" ] && STEP_FLAG="--then"
    if has_package_script "$SCRIPT_NAME"; then
      add_step "$STEP_FLAG" "$SCRIPT_NAME" "bun run $SCRIPT_NAME"
    else
      echo "[pre-push] $SCRIPT_NAME: no script, skipped"
    fi
  done
  add_guard_step guards kumiko-guards "guards"
  if has_ui_roots; then
    add_guard_step ui kumiko-guards "ui"
  else
    echo "[pre-push] ui: no uiRoots in kumiko.json, skipped"
  fi
  add_guard_step checks kumiko-guards "checks"
  add_guard_step comment-lang kumiko-guards "comment-lang --touched --base=origin/main"
  add_guard_step public-exports-changelog kumiko-guards "public-exports-changelog --base=origin/main"
  eval "set -- $STEP_ARGS"
  exec bun "$RUNNER" --fail-prefix "[pre-push] worktree check failed:" "$@"
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
    echo "Add a \"test\" script to package.json." >&2
    exit 1
  fi
  cd "$REPO_ROOT" && bun run test
fi
