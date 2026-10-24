---
"@cosmicdrift/kumiko-bundled-features": minor
---

The tenant aggregate is now a global systemStream entity: its stream, read row and search bucket live on SYSTEM_TENANT_ID.

<!-- kumiko-changes
feature: tenant
type: breaking
title: Tenant streams and rows live on the system tenant, seed defaults changed
detail: Tenants created, renamed or toggled by a SystemAdmin whose session tenant was neither 0001 nor the SYSTEM tenant landed in the event stream, read row and search bucket of that session tenant, so later updates could not find them. The tenant entity is now declared systemStream with tenancy global, so every writer (create, update, enable and disable, request and cancel destruction, the destroy job stages) addresses the stream on SYSTEM_TENANT_ID. seedTenant, seedUser, seedAdmin and seedAdminGuarded default to createSystemUser(SYSTEM_TENANT_ID) and write the tenant to SYSTEM whatever tenant an explicit by acts from; managed-pages and compliance-profiles seeds default to createSystemUser(tenantId). Existing memberships written by an admin of another tenant sit on that admin's stream while read_tenant_memberships.tenant_id carries the member tenant; after the backfill streamTenantId equals tenantId for them. New export backfillTenantStreamTenants from the tenant feature, built on the generic backfillAggregateStreamTenants in shared (backfillUserStreamTenants keeps its signature).
migration: |
  Run backfillTenantStreamTenants({ db, registry, searchAdapter }) once right after deploying this release. It merges split tenant streams onto SYSTEM_TENANT_ID, moves each membership stream to the tenantId of its payload, removes the stale search documents from the old tenant buckets, rebuilds the tenant:projection:tenant-entity and tenant:projection:tenant-membership-entity projections and reindexes the tenant search index on SYSTEM. Pass searchAdapter to include the search steps. The function is idempotent and reports per-aggregate failures in the result instead of aborting. Code that read tenant streams with loadAggregate(db, tenantId, "tenant") or appended tenant events with the tenant id as stream tenant must use SYSTEM_TENANT_ID. Until backfillTenantStreamTenants has run, versioned tenant writes (for example rename) and the destroy pipeline fail for unmigrated tenants, while enable and disable already append a split stream the backfill merges, so run it right after deploy and before any tenant write; it is idempotent and safe to run on every boot. Consumer workarounds that wrote tenant streams under a SystemAdmin `by` (for example an executor update with TestUsers.systemAdmin) are no longer needed, because the stream is always SYSTEM. Seeds that relied on the old by default (TestUsers.systemAdmin) now get the system user as audit actor.
-->
