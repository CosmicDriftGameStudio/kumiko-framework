# Embedded entity form

Host `RenderEdit` inside a `Drawer` instead of a dedicated screen — no nav
entry, no route. The form is prefilled from an externally-sourced record
(a suggestion, not this entity's own detail query), runs in controlled mode
so the host can read live dirty/valid state and re-validate after patching
values from outside, and saves through a custom write handler instead of
the built-in CRUD create.

## What it shows

- **`RenderEdit` without a screen or route** — `screen` is a plain
  `EntityEditScreenDefinition` literal, never passed to `r.screen`. Nothing
  about `RenderEdit` touches Nav or the router.
- **Create-mode prefill from an external source** — `initial` comes from a
  `suggestion` prop, `entityId={null}`, no detail-fetch for the entity being
  created.
- **Controlled mode** — `onChange` reports `{ dirty, valid }` on every
  keystroke; `onControlsReady` hands back `patch`/`validate` so the Drawer's
  footer can restore the suggestion's values and re-validate without a
  remount or a write.
- **`customSubmit` instead of the built-in CRUD create** — the client sends
  only the fields the user actually changed (`snapshot.changes`, the same
  delta the controlled mode reports); `prospect:accept` merges that onto the
  suggestion it already has server-side.
- **One write, two entities, atomically** — `prospect:accept` creates the
  prospect, stamps `source`/`acceptedBy`/`acceptedAt` (fields never on the
  edit form, so the client can't set them), and flips the suggestion to
  `accepted` — the same DB transaction, so a suggestion never ends up
  accepted without a prospect or vice versa.

## Feature composition

```
suggestion — externally-sourced draft, seeded via the standard CRUD create
prospect   — created only through prospect:accept, never through r.crud
```

## Flow

1. A caller has a `suggestion` (elsewhere seeded, e.g. by an AI extraction
   pipeline) and opens `AcceptSuggestionDrawer` next to it.
2. The Drawer prefills `RenderEdit` from the suggestion's fields.
3. The user edits a field or two; `onChange` updates the live status text.
4. Submit calls `customSubmit`, which dispatches `prospect:accept` with
   just `{ suggestionId, changes }`.
5. The handler merges `changes` onto the suggestion, creates the prospect,
   and marks the suggestion `accepted`. A second accept on the same
   suggestion is rejected (`unprocessable`).

## When to reach for it

You have a form that belongs next to something else — a list row, an inbox
item, a reference field — not on its own page, and saving it needs more
than a single-entity CRUD write (merging server-known data, writing a
second record, stamping fields the client must not control). Use the plain
`writeCommand` + built-in submit path instead when the form both lives on
its own screen and a single CRUD write is enough.

## Source

The feature entry point is `src/feature.ts`; the Drawer component is
`src/web/accept-suggestion-drawer.tsx`. Integration tests under
`src/__tests__/` cover the merge, the atomic status flip, the double-accept
rejection, and per-role access.
