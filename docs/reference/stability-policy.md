---
status: reference
verified: 2026-10-05
---

# Stability & deprecation policy

What you can rely on before Kumiko cuts a 1.0, and what changes as it
approaches one.

## Current status: pre-1.0 (`0.x`)

Kumiko is pre-1.0. Breaking changes land directly on `main` and ship in the
next minor release. There is no deprecation window and no parallel-support
period. Every breaking change carries a migration note in its package's
`CHANGELOG.md` and `changes.json`; some also ship a codemod. The root
[`CHANGELOG.md`](../../CHANGELOG.md) links all package changelogs.

## What this means if you build on Kumiko today

- Pin the exact version you depend on (workspace `resolutions` or a locked
  npm version) rather than a range — a minor bump can remove or rename an
  API.
- Before bumping, run `bunx kumiko-upgrade` to list every change between your
  installed and the target version, and `bunx kumiko-upgrade --apply` to run
  the codemods of pending breaking changes.
- Do not build tooling that depends on the shape of an internal module
  (anything not re-exported from a package's `index.ts`) — internals move
  without notice pre-1.0.

`kumiko-upgrade` ships with `@cosmicdrift/kumiko-cli` and with
`@cosmicdrift/kumiko-dev-server`, so a repo that only depends on the CLI and
`@cosmicdrift/kumiko-guards` has it too. It reads the installed version from
the repo itself: its own `node_modules`, then the framework's package
directories, then the repo's `bun.lock`. The lockfile covers the isolated
linker, which keeps transitive packages out of `node_modules`. A parent
workspace above the repo is never consulted.

## Breaking changes without a codemod

`kumiko-upgrade --apply` runs the codemods of all pending changes and moves
the marker in `.kumiko/upgrade-state.json` to the installed version in one
run. The upgrade-state guard fails while any changelog entry newer than the
marker is pending, so after a successful run it passes. If a codemod fails,
the marker stops at the highest pending version below the failed one.

A breaking change that ships no codemod is printed as `⚠ <version> · <title>
— no codemod, manual migration required` and recorded in the marker's
`pendingManual` list with a stable id of the form `<version>:<hash>`, for
example `0.341.0:3f9a12c4`. The hash comes from the title, so several manual
entries of the same version get different ids. Entries stay in the list across
later `--apply` runs until you resolve them. A run adds only entries newer than
the previous marker, so an entry you already resolved does not come back.

`bunx kumiko-upgrade` and `--json` (field `pendingManual`) list the open
entries. After migrating one by hand, mark it done:

```bash
bunx kumiko-upgrade --resolve 0.341.0:3f9a12c4 --reason "renamed the hook in src/screens"
bunx kumiko-upgrade --resolve 0.346.0 --reason "app sends no webhooks" --not-applicable
```

`--resolve` takes a full id or a version with exactly one open entry, and a
comma separated list of either. `--reason` is required (at most 500
characters). `--not-applicable` records the entry as not applicable instead of
migrated. The run resolves all given entries or none of them, and moves each
one to `resolvedManual` with the reason and a timestamp. `--resolve` cannot be
combined with `--apply`.

The guard checks pending changelog entries only. Open `pendingManual` entries
do not fail it, so review the list after every upgrade.

## Path to 1.0

There is no committed date. The signal for "close to 1.0" is: the core
request pipeline (dispatcher, event-store, registry) has gone through a
release cycle without a breaking rework, and the god-file refactors tracked
in `docs/plans/` have landed (large single-author files are exactly where
an API reshuffle is still likely). Once 1.0 ships, semantic versioning
applies, and breaking changes move to
major-version bumps with a deprecation window in the changelog before
removal.

## Reporting a breaking change you hit

If you hit an undocumented breaking change (not called out in the
package's `CHANGELOG.md`), that is a bug in the changelog, not an acceptable outcome —
open an issue.
