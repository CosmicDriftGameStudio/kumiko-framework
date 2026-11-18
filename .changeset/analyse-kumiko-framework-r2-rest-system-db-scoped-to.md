---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`ctx.systemDb.scopedTo(tenantId)` returns a tenant-mode db after the tenant self-check, and the delivery handlers use it.

<!-- kumiko-changes
feature: framework
type: improvement
title: systemDb.scopedTo returns a tenant-filtered db
detail: System-scoped handlers that only work inside the caller's tenant call `ctx.systemDb.scopedTo(tenantId)` instead of `assertTenantMatch(tenantId)`. They get a tenant-mode `TenantDb` on the same transaction: reads are filtered to the tenant plus system rows, writes are pinned to the tenant, and `unsafeRaw()` and `global()` are not available. `assertTenantMatch` keeps returning the unfiltered system db for writes with a foreign or system tenant id. `scopeTenantDbToTenant` now keeps the audit reporter, projection registry, personal-data gate and member read-only flag of its source.
-->

<!-- kumiko-changes
feature: delivery
type: fix
title: Delivery preference, opt-out, log and unsubscribe handlers read through a tenant-filtered db
detail: The handlers behind notification preferences, address opt-outs, the delivery log for tenant users and the unsubscribe page now run on `ctx.systemDb.scopedTo(...)`, so a query that forgets its `tenantId` condition can no longer read another tenant's rows. Apps change nothing.
-->
