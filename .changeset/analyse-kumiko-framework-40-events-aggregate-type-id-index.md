---
"@cosmicdrift/kumiko-framework": patch
---

The event store gets an `(aggregate_type, id)` index so scans over all events of one aggregate type no longer read the whole log.

<!-- kumiko-changes
feature: event-store
type: improvement
title: Index for type-wide, id-ordered event scans
detail: `streamAllEventsByType`, the projection rebuild batch query and the PII backfill page through `kumiko_events` by `aggregate_type` and `id`, and no index covered that, so each batch scanned the log. `createEventsTable` now ensures `events_aggregate_type_id_idx` on `(aggregate_type, id)` with `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, like the other secondary event indexes: existing installs get it at the next schema apply or boot, and an INVALID leftover is rebuilt.
-->
