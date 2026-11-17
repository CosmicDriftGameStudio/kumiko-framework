---
"@cosmicdrift/kumiko-bundled-features": minor
---

`cap-overview:query:caps:usage` hands app-owned `CapSpec.usage()` and `CapSpec.limit()` callbacks a tenant-mode db scoped to the target tenant, so a callback that forgets its `tenantId` filter no longer shows a TenantAdmin platform-wide totals.

<!-- kumiko-changes
feature: cap-overview
type: breaking
title: caps:usage hands cap callbacks a tenant-scoped db without unsafeRaw
detail: On the own-tenant call and on the SystemAdmin override, `usage(db, tenantId)` and `limit(tier, { db })` now receive a tenant-mode `TenantDb` that returns only the target tenant's rows plus reference rows of `SYSTEM_TENANT_ID`. Before, both got the unfiltered system-mode db, and an app callback without a `tenantId` filter leaked counts of every tenant. The handler no longer declares an `escapeHatch`, so `db.unsafeRaw()` inside these callbacks throws an `AccessDeniedError`; COUNT, SUM and AVG go through `db.count` and `db.aggregate`. `tenant-caps:list` is unchanged and still hands the system-mode db to `usage`, `usageBatch`, `limit` and `limitBatch`.
migration: A `CapSpec.usage()` or `limit()` that calls `db.unsafeRaw()` switches to `db.count` or `db.aggregate`. Keep the explicit `tenantId` filter, because tenant-caps:list still needs it. No callback in kumiko-studio or offlot-app uses `unsafeRaw()` or reads across tenants.
-->
