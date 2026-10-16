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

## Dependency checks

Three subcommands check the dependencies of the repo `cwd` sits in. They call
the npm registry or `bun audit`, so they are not part of the default run and
not part of `checks`; each takes `--report` (print only, exit 0; for `outdated`
it adds transitive and major-lag sections and a deprecated direct dependency
still exits 1). `outdated` lists every package the registry did not answer
as UNKNOWN with the reason and fails when no direct dependency got an answer.

```
bunx kumiko-guards licenses   # licence allow/gray/deny classification of installed packages
bunx kumiko-guards security   # bun audit: critical/high block, moderate warns
bunx kumiko-guards outdated   # installed direct dependencies the registry marks deprecated
```

Installed packages (`licenses`, `outdated`) are read from `node_modules` of the
repo root, its workspace members and every ancestor directory, the resolution
Bun itself uses, so a hoisted parent workspace and `.wt/` worktrees work. If
nothing is found the command fails ("nothing scanned"). `security` audits the
repo root's `bun.lock`, or the nearest ancestor's (announced) when the repo has
none, and fails if there is no lockfile at all.

Exceptions need a reason, a reviewer and an expiry date. The package ships
defaults (`dependency-license-exceptions.json`,
`dependency-security-exceptions.json`); a file of the same name in the repo
root (and, for `licenses`, in an ancestor whose `node_modules` was scanned) is
merged on top. A security exception that expires within 14 days blocks.

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
