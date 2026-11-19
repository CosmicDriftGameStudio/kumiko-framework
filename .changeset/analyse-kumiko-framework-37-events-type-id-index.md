---
"@cosmicdrift/kumiko-framework": patch
---

The event store gets a `(type, id)` index so projection rebuilds no longer scan the whole event history.

<!-- kumiko-changes
feature: framework
type: improvement
title: Index for projection rebuild scans
detail: Single-stream and multi-stream projection rebuilds read `kumiko_events` by `type` in `id` order; no index covered that. `ensureSecondaryEventIndexes` now also builds `events_type_id_idx` on `("type", "id")` with `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, so existing installs get it at the next schema apply or boot.
-->
