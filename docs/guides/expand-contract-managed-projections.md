---
status: reference
verified: 2026-07-18
---

# Expand/Contract for managed-projection changes

How to make a destructive change to a managed (`r.entity`/`r.projection`)
table across two releases instead of one, when a same-release `DROP+CREATE`
is a risk you want to avoid.

## When this applies

`migrate-generator` classifies a managed-table change as **in-place-unsafe**
(`managedChangeRequiresRecreate`) for: a dropped column, a new `NOT NULL`
column without a default, a new `UNIQUE` index, `SET NOT NULL`, or a column
type change. The generated migration `DROP+CREATE`s the table and queues a
rebuild — the generator itself now warns on this in the generated SQL,
naming the trigger(s) and pointing here.

That rebuild is **not free of risk today**: online-rebuild via shadow-schema
swap (kumiko-framework#401) plus live-tail catch-up (kumiko-framework#404)
close the empty-read-window for a single Postgres reader, but it is **not**
multi-pod zero-downtime — a still-running old-version pod mid rolling-deploy
cannot read a shape it doesn't know about. And if the change is a `NOT NULL`
column whose value isn't yet on every event in the stream, the replay-insert
fails outright (see "Scope limit" below) — that's not a maintenance-window
problem, it's a broken rebuild.

Splitting the change across two releases removes both risks. Small or empty
projection, no rolling-deploy traffic to worry about? The `DROP+CREATE` +
rebuild the generator already does is simpler — skip this guide.

## Managed projections are not a relational table

The classic Expand/Contract recipe (add nullable column, `UPDATE`-backfill
with SQL, flip `NOT NULL`) assumes you can backfill with a direct write.
A managed table is an event-stream derivative — a direct SQL backfill row
gets silently wiped on the next rebuild, because rebuild only reconstructs
what the *events* carry (see [entity write patterns](../reference/entity-write-patterns.md) for the general
direct-write-vs-rebuild failure mode). The backfill has to happen in event
terms, not in table terms.

## The pattern

### Release N — Expand

1. Add the column to the entity schema as **nullable**, no default required.
   This is in-place-safe (`ADD COLUMN`, no recreate, no rebuild).
2. Update the write path (executor / handler) so every new `create`/`update`
   emits the field going forward.
3. Give the historical events the field too, so a rebuild reconstructs it
   for every row — pick one:
   - **Upcaster**: register a migration on the event's schema version that
     derives/defaults the field for older stored payloads. Replay then
     produces the value for every row, old and new, without touching
     application data.
   - **Backfill via real writes**: if the value can't be derived from what's
     already on the event, issue actual `update()` calls for existing rows
     so the field lands via a real `<entity>.updated` event — never write
     the column directly.
4. Trigger a rebuild (`enqueueProjectionRebuild("<projection>")`,
   kumiko-framework#362) to confirm the shadow build now populates the
   column for the full stream. This already runs online via the shadow-swap
   mechanism — no separate maintenance step.

### Verify before N+1

Confirm every live row's event stream carries the field — e.g. query the
projection for `NULL`s after the rebuild, or check upcaster coverage against
the event version range in the stream. Don't flip to `NOT NULL` on a
guess.

### Release N+1 — Contract

Set the column `NOT NULL` (and drop the old column on a rename). The
generator still emits `DROP+CREATE` for this step — `managedChangeRequiresRecreate`
doesn't know about your two-release split, only about the single diff it's
looking at. What's different is that the replay now succeeds cleanly: every
event in the stream carries the field, so there's no NOT-NULL violation
mid-replay, and the shadow-swap mechanism keeps the cutover to a short
`ACCESS EXCLUSIVE` fence instead of a long lock.

## Scope limit

If the value genuinely cannot be derived or backfilled from the event
stream — the events never recorded it and there's no legitimate way to
reconstruct it after the fact — this is a data-migration problem, not a
schema-migration problem. Expand/Contract doesn't solve that; you need a
real backfill source (an external system, a manual data entry pass) before
any of this applies.

## Unmanaged tables

`r.storeTable` tables are real, non-derived data — the generator never
recreates them, and the standard relational Expand/Contract (`ADD COLUMN`
nullable → SQL `UPDATE` backfill → `SET NOT NULL`) applies as-is. No event
concerns.
