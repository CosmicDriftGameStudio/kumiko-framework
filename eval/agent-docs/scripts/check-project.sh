#!/usr/bin/env bash
# Grades one eval project after its agent has finished: copies the hidden
# acceptance test in, runs every check, then scans the agent's diff for rule
# breaks. Exit 0 only when every check passes; the scan hits need a human look.
#
# Usage: check-project.sh <project-dir> <task-id> <log-dir>
#   task-id: file stem under ../acceptance, e.g. 01-entity-crud
set -uo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: check-project.sh <project-dir> <task-id> <log-dir>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "$0")" && pwd -P)"
project_dir="$(cd "$1" && pwd -P)" || exit 2
task_id="$2"
log_dir="$3"

if ! [[ "$task_id" =~ ^[0-9]{2}-[a-z0-9-]+$ ]]; then
  echo "invalid task id: $task_id" >&2
  exit 2
fi
acceptance_template="$script_dir/../acceptance/$task_id.integration.test.ts.tmpl"
if [ ! -f "$acceptance_template" ]; then
  echo "no acceptance test for task $task_id" >&2
  exit 2
fi

mkdir -p "$log_dir"
log_dir="$(cd "$log_dir" && pwd -P)"
cd "$project_dir" || exit 2

acceptance_path="src/__tests__/eval-acceptance.integration.test.ts"
cp "$acceptance_template" "$acceptance_path"

framework_dir="node_modules/@cosmicdrift/kumiko-framework"
if [ -L "$framework_dir" ]; then
  echo "framework is a symlink, not the npm package" >&2
  exit 1
fi
version="$(bun -e 'console.log(require(process.argv[1]).version)' "$PWD/$framework_dir/package.json")"
# The agent could have edited node_modules; accept only a plain release number.
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "unexpected framework version: $version" >&2
  exit 1
fi
echo "framework: $version"

overall=0
run_check() {
  local name="$1"
  shift
  local log_file="$log_dir/$name.log"
  "$@" >"$log_file" 2>&1
  local status=$?
  if [ "$status" -eq 0 ]; then
    echo "PASS $name"
  else
    echo "FAIL $name (exit $status, log: $log_file)"
    overall=1
  fi
}

run_check typecheck bun run typecheck
run_check lint bun run lint
run_check unit bun run test
run_check boot bun run boot
run_check schema-validate bun kumiko-schema validate
run_check integration bun run test:integration
# The project's own guards: a bunx download of the guards package alone lacks
# the optional framework peer it imports, and the version matches the app.
run_check guards bun x --no-install kumiko-guards guards
run_check ui-guards bun x --no-install kumiko-guards ui

# Added lines outside the acceptance test. Every hit is a candidate, not a
# verdict: read it in context before calling it a rule break.
diff_file="$log_dir/agent.diff"
git add -A
git reset -q -- "$acceptance_path"
git diff --cached eval-baseline -- . ":(exclude)$acceptance_path" >"$diff_file"
git reset -q
added_lines="$(grep -E '^\+[^+]' "$diff_file" || true)"

scan() {
  local label="$1"
  local pattern="$2"
  local hits
  hits="$(printf '%s\n' "$added_lines" | grep -E -c -- "$pattern" || true)"
  echo "scan $label: $hits"
}
scan "any" '(:|as|<|\|)[[:space:]]*any([^A-Za-z0-9_]|$)'
scan "createTestDispatcher" 'createTestDispatcher'
scan "raw-sql-write" '(INSERT[[:space:]]+INTO|DELETE[[:space:]]+FROM|UPDATE[[:space:]]+[a-z_]+[[:space:]]+SET|\.unsafe\()'
scan "inline-style" 'style=\{\{'
scan "fetch" '(^|[^A-Za-z])fetch\('
echo "changed files:"
git status --short --untracked-files=all | grep -v -F "$acceptance_path" || true

exit "$overall"
