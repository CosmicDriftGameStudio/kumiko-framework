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

## `kumiko-pre-push`

A POSIX-sh pre-push hook, wired via a thin shim (e.g. `.husky/pre-push`
calling `bun node_modules/@cosmicdrift/kumiko-guards/src/pre-push.sh`). Inside
the cosmicdriftgamestudio parent workspace it runs a scoped `bun check` for
the pushing repo only; in a standalone clone it runs the repo's own
`package.json` `test` script. Set `PRE_PUSH_SKIP=1` to bypass.

Extension point: a tracked, executable `scripts/pre-push-extra.sh` runs
before the main check in every branch (worktree, parent-scoped, and
standalone), with `KUMIKO_PUSH_REPO_ROOT` and `KUMIKO_PUSH_PARENT_DIR`
available inline (never exported, so nothing else inherits them). An
untracked or non-executable `scripts/pre-push-extra.sh` is never run — this
is fail-closed so a stray or unreviewed file can't hijack push. A non-zero
exit from `pre-push-extra.sh` aborts the push before the main check runs.
