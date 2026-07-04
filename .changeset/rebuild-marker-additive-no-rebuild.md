---
"@cosmicdrift/kumiko-framework": patch
---

fix(schema): `kumiko schema generate` no longer emits a projection-rebuild marker for a pure additive nullable `ADD COLUMN`.

Such a column is an in-place ALTER that already brings the managed table to the target state (same reasoning #181 applied to index-/default-/nullability-only changes). Emitting a rebuild marker anyway triggered a full truncate+replay whose shadow-swap could **drop the freshly migrated column** — the rebuild runs from the rebuilding process's registry meta, so on a rolling deploy an older pod (meta without the new column) rebuilds the projection without it → phantom migration (recorded applied, column physically absent) → boot drift-check crash. Same class as `0008_add_pending_deletion_request_id` (read_users) / #494 / #835.

Rebuild markers are now emitted only when the generated SQL actually recreates the table (`managedChangeRequiresRecreate`: dropped column, NOT NULL without default, unique index, type/nullability change). If a new additive column genuinely needs value-backfill from historical events, opt in explicitly by hand-adding a `NNNN_<name>.rebuild.json` next to the migration.

Note: this closes the additive-column path. The underlying rolling-deploy race (a stale-registry pod can still wipe columns during a recreate-triggered rebuild) is tracked separately.
