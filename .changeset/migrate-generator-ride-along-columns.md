---
"@cosmicdrift/kumiko-framework": minor
---

migrate-generator: ride-along columns/indexes + Drift Layer 3 (#347)

The migration generator (`collectTableMetas` / `kumiko schema generate`) derived
each table's DDL purely from `entity.fields`, so columns and indexes that live
only on a separate Drizzle `table()` object — secrets' `envelope`/`metadata`/
`last_rotated_at` + the `(tenant, key)` uniqueIndex — were invisible and never
emitted. The first prod write then hit a missing column (publicstatus#116).

- **New `r.entity(name, def, { table })`** declares a backing table as the
  physical DDL truth for tables whose columns can't be expressed via the
  field-DSL (jsonb-without-default, `now()`-default). It is validated as a
  superset of the entity's fields and is the single table shared by the
  generator, the implicit projection (executor + rebuild) and the test-push —
  restoring the generate==push invariant. Wired on `secrets` and `delivery`.
- **Drift Layer 3:** the boot-time schema-drift gate now also column-diffs each
  existing snapshot table against the live DB. A migrated-but-incomplete table
  fails boot with a `SchemaDriftError` + regen hint instead of a runtime-500.
