---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-framework": minor
---

The tenant aggregate is now a global systemStream entity: its stream, read row and search bucket live on SYSTEM_TENANT_ID.

<!-- kumiko-changes
feature: tenant
type: breaking
title: Tenant streams and rows live on the system tenant, seed defaults changed
detail: Tenants created, renamed or toggled by a SystemAdmin whose session tenant was neither 0001 nor the SYSTEM tenant landed in the event stream, read row and search bucket of that session tenant, so later updates could not find them. The tenant entity is now declared systemStream with tenancy global, so every writer (create, update, enable and disable, request and cancel destruction, the destroy job stages) addresses the stream on SYSTEM_TENANT_ID. seedTenant, seedUser, seedAdmin and seedAdminGuarded default to createSystemUser(SYSTEM_TENANT_ID) and write the tenant to SYSTEM whatever tenant an explicit by acts from; managed-pages and compliance-profiles seeds default to createSystemUser(tenantId). Existing memberships written by an admin of another tenant sit on that admin's stream while read_tenant_memberships.tenant_id carries the member tenant; after the backfill streamTenantId equals tenantId for them. New export backfillTenantStreamTenants from the tenant feature, the boot step runStreamTenantBackfillOnBoot in server-runtime, EsOperationType gains "stream-migration", built on the generic backfillAggregateStreamTenants in shared (backfillUserStreamTenants keeps its signature).
migration: |
  Nothing to run: runProdApp (api, all-in-one) and runWorkerApp run the backfill automatically at boot, before the boot seeds respectively before the worker starts. It merges split tenant streams onto SYSTEM_TENANT_ID, moves each membership stream to the tenantId of its payload, moves legacy user streams, removes stale search documents from the old buckets, rebuilds tenant:projection:tenant-entity, tenant:projection:tenant-membership-entity and user:projection:user-entity where streams moved and reindexes the tenant and user search indexes. Completion is recorded in kumiko_es_operations (ids stream-tenant-backfill:user and stream-tenant-backfill:tenant); with the markers present a boot does no work. Parallel boots are serialized by a Postgres advisory lock, failures are logged (aggregateId, step, error) and retried on the next boot. A process without a search adapter leaves the work to one that has it. Set KUMIKO_SKIP_STREAM_TENANT_BACKFILL=1 to opt out, and delete the marker row to re-run a part by hand. Library users can call backfillTenantStreamTenants or backfillUserStreamTenantsWithDerivedState directly. Code that read tenant streams with loadAggregate(db, tenantId, "tenant") or appended tenant events with the tenant id as stream tenant must use SYSTEM_TENANT_ID. Consumer workarounds that wrote tenant streams under a SystemAdmin `by` (for example an executor update with TestUsers.systemAdmin) are no longer needed, because the stream is always SYSTEM. Seeds that relied on the old by default (TestUsers.systemAdmin) now get the system user as audit actor.
-->
