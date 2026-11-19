---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": patch
---

An entity row now carries the version of its event stream, so list and detail no longer look up the stream version for every row.

<!-- kumiko-changes
feature: framework
type: breaking
title: Entity rows follow their stream version; list and detail drop the per-row event-store lookup
detail: A domain event appended through `ctx.events.append`, `appendOne`, a job or a multi-stream apply on an entity row's stream (aggregate type equals the entity name) now sets the row's `version` to the event's version in the same transaction, and a rebuild of the entity's implicit projection restores it from the event log. List and detail return `row.version` and no longer run a correlated `MAX(version)` subquery against `kumiko_events` for every row. Writes keep reading the stream version for their optimistic lock. Events appended without the projection pipeline (event-store `append`, `appendEventInTenantDb` without `registry`) do not move the row version.
migration: Rows that received domain events before this release kept their old version; `runProdApp` and `runWorkerApp` now align them with their stream on every boot in the background (only the `read_*` rows change, the event log stays untouched), so no rebuild by hand is needed. It works in id batches of short transactions with a short lock_timeout; a table that hits the lock_timeout or fails is logged and finished on the next boot, and until then editing such a row can still fail with `version_conflict`. The same repair is exported as `alignLiveRowVersionsWithStreams(db, tableName, aggregateTypes, systemStream, { batchSize, signal })` from `@cosmicdrift/kumiko-framework/db` for apps that boot without `runProdApp` or `runWorkerApp`. Append domain events on an entity row's stream with the entity name as aggregate type and through `ctx.events.append`, not through the event-store `append`.
affects: all
-->
