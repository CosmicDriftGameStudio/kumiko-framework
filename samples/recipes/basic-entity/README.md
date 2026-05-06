# Basic entity

Wire one event-sourced aggregate end-to-end with the framework's built-in CRUD
helpers. The recipe ships a `task` entity with the standard verbs — create,
update, delete, restore, list, detail — registered explicitly, plus
soft-delete enabled.

This is the smallest useful sample: it demonstrates the path from
`createEntity({ fields })` to a working API surface without writing any Zod
schemas or handler bodies by hand.

## What it shows

- **`createEntity` with field factories** — typed text, boolean, number
  fields with options like `required`, `sortable`, `softDelete`.
- **`defineEntityCreateHandler` / `defineEntityUpdateHandler` / etc.** —
  one helper per CRUD verb; each one returns a write- or query-handler
  definition that you register with `r.writeHandler` / `r.queryHandler`.
- **Per-verb access rules** — different roles can create vs. update vs.
  delete. Editor and User roles can write; only Admin can delete or restore.
- **Soft delete** — `softDelete: true` on the entity gives the executor an
  `isDeleted` column and the `delete` handler flips it instead of dropping
  the row. `restore` flips it back.

## When to reach for it

You're starting a new feature with a single entity and want CRUD without
inventing your own handlers. Replace any single line with an explicit
`r.writeHandler({ name, schema, handler })` when you outgrow the defaults
— see [custom-handlers](../custom-handlers/) for that path.

## Source

The whole feature lives in `src/feature.ts` (~50 lines). Integration tests
under `src/__tests__/` exercise list-with-sort, soft-delete + restore, and
the per-verb access boundaries.

```bash
yarn kumiko test integration samples/basic-entity
```
