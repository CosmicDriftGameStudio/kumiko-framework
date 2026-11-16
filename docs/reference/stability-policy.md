---
status: reference
verified: 2026-11-16
---

# Stability & deprecation policy

What you can rely on before Kumiko cuts a 1.0, and what changes as it
approaches one.

## Current status: pre-1.0 (`0.x`) until January 2027

Kumiko is pre-1.0. Breaking changes land directly on `main` and ship in the
next minor release. There is no deprecation window and no parallel-support
period. Every breaking change carries a migration note in its package's
`CHANGELOG.md` and `changes.json`; some also ship a codemod. The root
[`CHANGELOG.md`](../../CHANGELOG.md) links all package changelogs.

## Beta from January 2027

The first release train in the first week of January 2027 starts the beta.
The plan with the remaining work is
[`docs/plans/release-channels-beta-1.0.md`](../plans/release-channels-beta-1.0.md).

- The npm dist-tag `latest` moves only with a release train, every two weeks.
  `next` gets a canary version (`0.X.Y-next-<sha>`) for every merge to `main`.
  Ranges never match prerelease versions, so `next` never reaches a `latest`
  user by accident.
- A minor bump means a breaking change (changesets follow this already); fixes and improvements are patch
  releases. `^0.X.0` takes every train up to the next breaking one.
- Breaking changes reach `latest` only with a train, each with a migration
  note and, where the change is mechanical, a codemod.
- Hotfixes between trains are limited to security issues and data loss and
  ship as a patch release from a `release/0.X` branch.
- A train runs only when every Cosmic Drift app is green against `main`;
  otherwise it is skipped and the next one runs two weeks later.

## What this means if you build on Kumiko today

- Until the beta, pin the exact version you depend on (workspace `resolutions`
  or a locked npm version) rather than a range, because a minor bump can remove
  or rename an API. From the beta on, `^0.X.0` on `latest` is safe.
- Before bumping, run `bunx kumiko-upgrade` to list every change between your
  installed and the target version, and `bunx kumiko-upgrade --apply` to run
  the codemods of pending breaking changes.
- Do not build tooling that depends on the shape of an internal module
  (anything not re-exported from a package's `index.ts`) — internals move
  without notice pre-1.0.

`kumiko-upgrade` ships with `@cosmicdrift/kumiko-cli`. It reads the installed version from
the repo itself: its own `node_modules`, then the framework's package
directories, then the repo's `bun.lock`. The lockfile covers the isolated
linker, which keeps transitive packages out of `node_modules`. A parent
workspace above the repo is never consulted for the version, and changelog
entries newer than the installed version are never pending.

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

## Release window

- The Version PR is merged only by the framework owner (a person, never an agent session) once the work package is green. Until the beta there is no fixed release day; from January 2027 the Version PR is the release train and is merged every two weeks on the same weekday.
- A `breaking` entry needs a non-empty `migration` text, and `codemod` where one
  can be automated. Without a codemod it lands in the consumer's `pendingManual`
  list, see above. `scripts/guard-changes-json.ts` enforces `migration`;
  `scripts/changeset-required-check.sh` enforces that a changeset exists.
- The Version PR is never auto-merged.

## Path to 1.0

The target is June 2027. The date moves until all of these hold:

- three trains in a row with at most three breaking entries each;
- every stable Cosmic Drift app runs on `latest` and was green at each train;
- the core request pipeline (dispatcher, event-store, registry) has gone
  through a release cycle without a breaking rework, and the god-file
  refactors tracked in `docs/plans/` have landed (large single-author files
  are exactly where an API reshuffle is still likely).

Once 1.0 ships, semantic versioning applies. Trains bring fixes, additions
and deprecations with a warning and a codemod; removals move to major
versions, batched at most twice a year. `next` stays available.

## Reporting a breaking change you hit

If you hit an undocumented breaking change (not called out in the
package's `CHANGELOG.md`), that is a bug in the changelog, not an acceptable outcome —
open an issue.
