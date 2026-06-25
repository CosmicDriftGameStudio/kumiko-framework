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

## Feature composition

```
task-management → single feature, single `task` entity, six CRUD handlers
```

No bundled features required — this is the baseline before you add
`r.requires("tenant")`, auth, or cross-feature extensions.

## Flow

1. Define fields with `createEntity({ fields: { … } })`.
2. Register create/update/delete/restore/list/detail via `defineEntity*Handler`.
3. Client calls `task-management:write:task:create` → row + event appended.
4. `delete` soft-flips `isDeleted`; `restore` flips back; `list` excludes
   deleted rows by default.

## When to reach for it

You're starting a new feature with a single entity and want CRUD without
inventing your own handlers. Replace any single line with an explicit
`r.writeHandler({ name, schema, handler })` when you outgrow the defaults
— see [custom-handlers](/en/samples/recipes-custom-handlers/) for that path.

## Tests

```bash
bun kumiko test integration samples/basic-entity
```

Integration tests under `src/__tests__/` exercise list-with-sort,
soft-delete + restore, and per-verb access boundaries (Editor vs Admin).

## Related samples

- [custom-handlers](/en/samples/recipes-custom-handlers/) — replace generated
  CRUD helpers with explicit handlers.
- [field-access](/en/samples/recipes-field-access/) — per-field read/write
  rules on top of the same entity pattern.
- [custom-fields-basic](/en/samples/recipes-custom-fields-basic/) — tenant-
  defined extra columns without migrations.
