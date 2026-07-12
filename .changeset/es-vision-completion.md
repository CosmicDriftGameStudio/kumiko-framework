---
"@cosmicdrift/kumiko-framework": minor
---

Event-sourcing ergonomics (closes the remaining pivot-vision gaps, #959):

- `r.crud(name, entity, options?)` — registrar sugar delegating to `registerEntityCrud()`; same handlers, same events, no behaviour change.
- Declarative event migrations: `r.eventMigration(name, from, to, { rename, default, map })` compiles to an `EventUpcastFn` (fixed order rename → default → map); the imperative function form stays.
- Auto-snapshot policy: `loadAggregateWithSnapshot(..., { snapshotEvery: N, snapshotVersion: G })` persists a snapshot after folding ≥ N delta events (best-effort) and ignores stored snapshots from another reducer-shape generation. Adds a `snapshot_version` column to `kumiko_snapshots` — existing installs are healed by the idempotent ensure that `kumiko schema apply` already runs.
