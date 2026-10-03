# @cosmicdrift/kumiko-guards

AST-based security guards for a single Kumiko repo: direct filesystem
access, direct fetch, direct entity writes, admin-API misuse, tenant
escalation, undeclared escape hatches, `openToAll` without a reason, and
missing access-denied tests. Every finding must clear the repo's own
security baseline — there is no per-guard skip flag.

```
bun node_modules/@cosmicdrift/kumiko-guards/src/run-guards.ts [--explain|--write-security-baseline]
```

The baseline lives at `.kumiko-security-baseline.json` in the consumer
repo's root. `--explain` prints the resolved repo and per-guard scan scope
without running any guard; `--write-security-baseline` freezes current
findings into the baseline file.

## Raw-SQL markers

`guard-raw-sql` blocks `.unsafe()` / `asRawClient()` outside `db/queries/*`,
`bun-db/query.ts` and testing code. A `// kumiko-lint-ignore raw-sql <reason>`
marker on the call's line or the line above only suppresses while its
(file, reason) pair is frozen in `.kumiko-raw-sql-baseline.json` at the repo
root. A new or reworded marker without a baseline entry fails the check, so
every exception shows up as a baseline diff in review. Without a baseline file
the guard only warns, so consumers do not break on bump. Prefer a typed
`bun-db` helper; freeze a deliberate exception with:

```
bunx kumiko-guards checks --write-baseline --guard=guard-raw-sql
```

Rewording the reason is a new entry: re-run the command and review the diff.
A removed marker leaves a stale entry that does not fail; the same command
drops it.

## `kumiko-pre-push`

A POSIX-sh pre-push hook, wired by copying the package's `hooks/pre-push`
shim to `.husky/pre-push`. The shim execs the nearest executable
`node_modules/.bin/kumiko-pre-push` from the repo root upwards (so worktrees
without their own `node_modules` resolve via the parent install) and fails
closed with a `bun install` / `PRE_PUSH_SKIP=1` hint when none exists. Inside
the cosmicdriftgamestudio parent workspace it runs a scoped `bun check` for
the pushing repo only; in a standalone clone it runs the repo's own
`package.json` `test` script. From a `.wt/<name>` worktree under the parent
workspace it runs a tracked `scripts/check-wt.sh` if present, otherwise the
worktree's own `package.json` scripts `typecheck`, `lint`, `test`, and
`test:dom` (whichever are declared), directly in the worktree — the parent's
`bun check` would otherwise check the main checkout instead. Set
`PRE_PUSH_SKIP=1` to bypass.

Extension point: a tracked, executable `scripts/pre-push-extra.sh` runs
before the main check in every branch (worktree, parent-scoped, and
standalone), with `KUMIKO_PUSH_REPO_ROOT` and `KUMIKO_PUSH_PARENT_DIR`
available inline (never exported, so nothing else inherits them). An
untracked or non-executable `scripts/pre-push-extra.sh` is never run — this
is fail-closed so a stray or unreviewed file can't hijack push. A non-zero
exit from `pre-push-extra.sh` aborts the push before the main check runs.
