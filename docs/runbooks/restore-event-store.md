---
status: reference
verified: 2026-10-19
evidence: "event-store/events-schema.ts, snapshot.ts, archive.ts, pipeline/event-consumer-state.ts, projection-state.ts, migrations/kumiko-drift.ts, server-runtime/src/run-prod-app.ts (schema-drift gate), schema-cli.ts, guards/src/guard-event-store-writes.ts; backup side checked against infra docs/runbooks/restore.md (2026-10-19)"
---

# Restoring the event store

The framework has no backup or restore tooling of its own. The event store is ordinary Postgres
tables, so a restore is a database restore done on the infrastructure side. This runbook says
what the framework expects around it. The commands for the restore itself are in the infra
runbooks:

- [restore.md](https://github.com/CosmicDriftGameStudio/infra/blob/main/docs/runbooks/restore.md): CNPG and Velero restore, scenarios and drills
- [subject-keys-disaster-recovery.md](https://github.com/CosmicDriftGameStudio/infra/blob/main/docs/runbooks/subject-keys-disaster-recovery.md): the `subject-keys` cluster
- [offsite-backup-scaleway.md](https://github.com/CosmicDriftGameStudio/infra/blob/main/docs/runbooks/offsite-backup-scaleway.md): offsite copy

## What is backed up, and in what format

The format is Postgres physical backups (CNPG barman base backup plus WAL for the app database
`pg18`, Velero for Kubernetes resources and volumes), not a Kumiko export. There is no
event-level export or import command in the framework.

These tables belong together and live in the app database:

| Tables | Role |
| --- | --- |
| `kumiko_events`, `kumiko_snapshots`, `kumiko_archived_streams` | The event store: source of truth |
| `kumiko_event_consumers` | Cursor per event consumer (`last_processed_event_id`) |
| `kumiko_projections`, `kumiko_pending_rebuilds` | Projection state, queued rebuilds |
| entity projection tables, `_kumiko_migrations` | Read models, applied migrations |

PII fields are stored as ciphertext. The keys that open them live in a second Postgres cluster
(`subject-keys`). Restoring the app database without its keys yields data nobody can read, so
both clusters are restored to the same point in time (see the infra restore runbook).

Not covered by this restore: files in object storage, the search index and Redis (idempotency
and cache entries, job queue state). Check job runs afterwards in `jobs:query:list`.

## Order

1. Restore the app database and `subject-keys` to one target time, following the infra runbook.
   Restore the whole database. Do not restore single event-store tables into a running database:
   events, cursors and projections must all come from the same moment.
2. Before starting the app, check the cursors against the events (read-only):

   ```sql
   SELECT (SELECT coalesce(max(id), 0) FROM kumiko_events) AS max_event_id,
          name, instance_id, last_processed_event_id, status
   FROM kumiko_event_consumers
   WHERE last_processed_event_id > (SELECT coalesce(max(id), 0) FROM kumiko_events);
   ```

   Zero rows is the expected result. A cursor above `max(id)` means the tables come from different
   points in time. Consumers read `id > cursor`, so such a consumer would miss new events until
   the ids catch up. Go back to step 1 and restore consistently instead of editing the cursor.
3. If the restore point is older than the migrations in the deployed code, run
   `bunx kumiko-schema status` and then `bunx kumiko-schema apply`. The app refuses to boot on a
   schema drift (`SchemaDriftError` in `run-prod-app.ts`, no auto-heal). `apply` also drains
   `kumiko_pending_rebuilds`.
4. Start the app. Check `bun kumiko consumer list` (nothing `dead`) and `bun kumiko project list`
   (nothing `failed`). Consumers continue from their restored cursor and process the events after
   it again.
5. Search: the search consumer is a normal cursor consumer (`system:consumer:search`). For an
   entity whose index looks wrong, run the manual job `jobs:job:reindex-entity` with
   `{ "entity": "<name>" }` through `jobs:write:trigger` as `SystemAdmin`. Whether documents
   written after the restore point are removed from an external index was not checked.

## Rebuild afterwards

A consistent full restore needs no rebuild: the projection tables were restored with the events.
Rebuild a projection only when it is wrong for another reason, with the tools in
[event-rebuild](./event-rebuild.md). A failed or stuck consumer is handled in
[dead-letter](./dead-letter.md).

If only the event store was brought back and the read models are empty or from another time,
rebuild every projection, one at a time. The replay needs the full log: events removed earlier by
`pruneEvents` are not recoverable from the projections.

## What must not be done

- No `INSERT`, `UPDATE` or `DELETE` on `kumiko_events`, `kumiko_snapshots` or
  `kumiko_archived_streams`. The guard `guard-event-store-writes.ts` blocks it in code, and a
  hand-written row skips the version-unique index, archive markers and tenant boundary.
- Do not use `event-store/admin-api` to refill a restored store. It is the import path for legacy
  data from other systems and is guarded against app code.
- Do not move a consumer cursor by hand. `consumer skip` and `consumer restart` are the supported
  ways.
- `restore` in the code (`restoreStream`, the `<entity>:restore` handler) means undeleting a
  soft-deleted stream. It has nothing to do with backup restore.

## What has no tooling

- No framework command to back up, export, import or verify the event store; use the infra runbook.
- No command that checks cursors against `max(id)`; the query above is the check.
- No command that rebuilds all projections at once.
- No check that the app database and `subject-keys` are at the same time; the infra runbook
  prescribes the same `targetTime` and a decrypt round trip.
