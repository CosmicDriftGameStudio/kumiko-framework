---
"@cosmicdrift/kumiko-framework": patch
---

`ctx.db.updateMany` refuses a `tenantId` in `set`, so a tenant-scoped update can no longer move a row into another tenant.

<!-- kumiko-changes
feature: framework
type: fix
title: Tenant-scoped updateMany cannot change tenantId
detail: `upsert` already refused `tenantId` in `update`, but `updateMany` on a tenant-mode `TenantDb` passed a `tenantId` (or `tenant_id`) in `set` through. With row level security on, Postgres rejected the foreign tenant via WITH CHECK; with `rowLevelSecurity: "off"` the row moved. The call now fails with `AccessDeniedError` before any SQL runs. System-mode `TenantDb` instances are unchanged.
-->
