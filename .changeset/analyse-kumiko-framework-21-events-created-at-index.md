---
"@cosmicdrift/kumiko-framework": patch
---

The event store gets a `created_at` index so the audit-writes metric no longer scans the whole event history.

<!-- kumiko-changes
feature: event-store
type: improvement
title: Index for time-window counts over all events
detail: The `audit-writes` default metric counts `kumiko_events` of the last 14 days by `created_at`, in the system scope across all tenants; no index covered that, so every system overview scanned the event store. `ensureSecondaryEventIndexes` now also builds `events_created_at_idx` on `(created_at)` with `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, so existing installs get it at the next schema apply or boot.
-->
