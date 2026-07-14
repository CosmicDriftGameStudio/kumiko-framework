---
status: reference
verified: 2026-07-14
---

# Stability & deprecation policy

What you can rely on before Kumiko cuts a 1.0, and what changes as it
approaches one.

## Current status: pre-release (`0.0.0`)

Kumiko is pre-1.0. Breaking changes land directly on `main` — there is no
deprecation window, no parallel-support period, no codemod tooling for
consumers today. This has already happened multiple times (the transactional
outbox was replaced by the async event-dispatcher; `r.postEvent()` was
removed in favor of `r.multiStreamProjection()`; the audit-trail hook was
reworked). Each of those is documented in `CHANGELOG.md` under `## Unreleased`
with an `### Added` / removal note in the same entry — that changelog entry
is the only migration guidance that exists right now.

## What this means if you build on Kumiko today

- Pin the exact version you depend on (workspace `resolutions` or a locked
  npm version) rather than a range — a minor bump can remove or rename an
  API.
- Before bumping, read the `CHANGELOG.md` diff between your current and
  target version — not just the latest entry.
- Do not build tooling that depends on the shape of an internal module
  (anything not re-exported from a package's `index.ts`) — internals move
  without notice pre-1.0.

## Path to 1.0

There is no committed date. The signal for "close to 1.0" is: the core
request pipeline (dispatcher, event-store, registry) has gone through a
release cycle without a breaking rework, and the god-file refactors tracked
in `docs/plans/` have landed (large single-author files are exactly where
an API reshuffle is still likely). Once 1.0 ships, semantic versioning
applies per `CHANGELOG.md`'s stated intent, and breaking changes move to
major-version bumps with a deprecation window in the changelog before
removal.

## Reporting a breaking change you hit

If you hit an undocumented breaking change (not called out in
`CHANGELOG.md`), that is a bug in the changelog, not an acceptable outcome —
open an issue.
