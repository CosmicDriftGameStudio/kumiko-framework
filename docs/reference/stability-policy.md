---
status: reference
verified: 2026-09-25
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

## Breaking changes without a codemod

`kumiko-upgrade --apply` records the version it brought the app to in
`.kumiko/upgrade-state.json`, and the upgrade-state guard fails while any
change newer than that marker is still pending. A breaking change that ships
no codemod is printed as `⚠ <version> · <title> — no codemod, manual migration
required`. Where the marker lands depends on what else is pending:

- If other pending changes sit below the earliest manual one, the marker
  stops at the highest of them, and the guard keeps listing the manual change.
  Migrate it by hand, then run `bunx kumiko-upgrade --apply` again. That
  second run is the acknowledgement: with nothing left below the manual
  change, it moves the marker past it, to the latest non-breaking change or
  the installed version.
- If nothing pending sits below the earliest manual change, the first run
  already moves the marker past it. The guard does not list it afterwards, so
  migrate it right away.

The run prints which of the two happened, next to the path of the marker it
wrote.

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
