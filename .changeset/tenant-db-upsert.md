---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

TenantDb gets `upsert(table, values, { conflictTarget, update? })`, a tenant-safe INSERT ... ON CONFLICT DO UPDATE.

<!-- kumiko-changes
feature: framework
type: improvement
title: Tenant-safe upsert on ctx.db
detail: ctx.db.upsert(table, values, { conflictTarget, update? }) requires tenantId in conflictTarget and the target to match a declared unique index or primary key. The update only touches the row of the inserted tenant, update may not set tenantId, and the default update leaves conflict, primary-key and tenant columns alone. Event-fed tables are rejected. Replaces unsafeRaw plus upsertOnConflict for tenant-scoped upserts.
-->
