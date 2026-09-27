---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-guards": minor
---

tenant-handover's claim handler moved event-store ownership between tenants with a raw `UPDATE kumiko_events SET tenant_id …` directly inside a bundled feature — bypassing the event store's own invariants (version-unique index, archive markers, tenant boundary) and leaving no audit trail of the move beyond the feature's own claimed-event summary.

That responsibility now lives in the event store itself: `transferAggregateStreams`, a framework-owned primitive that moves a set of aggregates' events, drops their snapshots, carries their archive markers, and appends a `kumiko:system:aggregate.transferred` event per moved aggregate on its own fresh stream in the destination tenant.

<!-- kumiko-changes
feature: framework
type: improvement
title: New event-store primitive transferAggregateStreams for tenant-to-tenant aggregate moves
detail: |
  `transferAggregateStreams(db, { sourceTenantId, destinationTenantId,
  aggregateType, aggregateIds, transferredBy })` (event-store/transfer.ts)
  moves an aggregate's events, drops its snapshot, and carries its archive
  marker from one tenant to another, then appends one
  `kumiko:system:aggregate.transferred` system event per moved aggregate
  (own fresh stream, destination tenant, payload carries aggregateType/
  aggregateId/sourceTenantId/destinationTenantId). An id with no events
  under the given tenant/aggregateType is left untouched and gets no event.
  Backed by db/queries/event-store-transfer.ts.
migration: |
  No action for existing consumers — this is a new, additive primitive.
-->

<!-- kumiko-changes
feature: tenant-handover
type: improvement
title: Claim now moves event-store ownership through transferAggregateStreams instead of raw SQL
detail: |
  move-entity-graph.ts no longer runs its own `UPDATE kumiko_events` /
  `UPDATE kumiko_snapshots` against the event store — it calls the
  framework's `transferAggregateStreams` per aggregate type, threading the
  claiming user's id as `transferredBy`. Archive markers now move with the
  stream (previously left behind under the source tenant). Each moved
  aggregate gets its own `kumiko:system:aggregate.transferred` audit event
  in the destination tenant, in addition to the existing
  `tenant-handover:event:claimed` summary event.
migration: |
  No action needed — the claim API and its response shape are unchanged.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: New guard blocks direct writes to the event-store tables outside the event store itself
detail: |
  guard-event-store-writes.ts flags any UPDATE/DELETE FROM/INSERT INTO
  string or template literal naming kumiko_events, kumiko_snapshots, or
  kumiko_archived_streams outside packages/framework/src/event-store/**
  and their db/queries/event-store*.ts backing (plus the two pre-existing,
  named one-time backfill exceptions). Registered in run-guards.ts.
migration: |
  No action needed for code that already goes through the event store's
  own primitives (append, transferAggregateStreams, archiveStream, ...).
  A direct raw-SQL write against one of these three tables from feature
  code now fails the guard; use transferAggregateStreams for a tenant
  move, or add a new event-store primitive instead.
-->
