---
"@cosmicdrift/kumiko-framework": minor
---

migrate-generator: projection-aware migrations (#356)

Schema changes to a **managed** projection (`r.entity`) that cannot apply
in-place against existing rows — `NOT NULL` without a default, a `UNIQUE` index,
`SET NOT NULL`, a type change, or a dropped/renamed column — are now generated as
`DROP TABLE` + `CREATE TABLE` (new shape) instead of an additive `ALTER` that
dies on the very rows the projection rebuild discards anyway. The rebuild marker
refills the recreated table from the event stream. **unmanaged** tables
(`defineUnmanagedTable`, real non-derived data) keep additive `ALTER` plus the
commented `-- DESTRUCTIVE` statements, unchanged.

The split is driven by `EntityTableMeta.source`, which lives in the
generate-time snapshot — so it is a pure generate decision: no registry
awareness, no runtime DDL-from-code, the apply path stays a dumb SQL runner.
`rebuildTablesFromDiff` is now managed-only (unmanaged tables are never
event-rebuilt) and includes the recreate cases.

Caveat: DROP+CREATE empties the projection before the rebuild refills it, so it
is only safe for projections whose events carry every column. A managed table
with columns that are NOT derivable from the event stream must not rely on this
path — that is a data migration, not a schema change.
