---
"@cosmicdrift/kumiko-framework": patch
---

The event store gets a `(tenant_id, id)` index so the audit list no longer scans a tenant's whole event history.

<!-- kumiko-changes
feature: framework
type: improvement
title: Index for tenant-scoped, id-ordered event reads
detail: The audit list filters `kumiko_events` by `tenant_id` and pages by `id`; no index covered that, so every page scanned the tenant's events. `createEventsTable` now ensures `events_tenant_id_idx` on `(tenant_id, id)` with `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, the same way as the membership payload index: existing installs get it at the next schema apply or boot, an INVALID leftover is rebuilt, and a concurrent build by another pod is tolerated. `ensureMembershipPayloadTenantIndex` is replaced by `ensureSecondaryEventIndexes`, which builds both indexes.
-->
