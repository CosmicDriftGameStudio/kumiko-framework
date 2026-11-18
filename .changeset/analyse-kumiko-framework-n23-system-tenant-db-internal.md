---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

The public `createTenantDb` builds only tenant-mode handles; system mode, `grants` and handles on an `unsafeRaw()` runner are framework-internal.

<!-- kumiko-changes
feature: framework
type: breaking
title: createTenantDb on the db subpath is tenant-only
detail: `createTenantDb` from `@cosmicdrift/kumiko-framework/db` takes `{ db, tenantId, tracer?, meter?, signal?, mode?: "tenant" }` and always builds a tenant-mode handle. `mode: "system"`, `reason` and `grants` are no longer accepted there. The full function lives in `@cosmicdrift/kumiko-framework/internal/row-level-security` for framework packages and in `@cosmicdrift/kumiko-testing/helpers` for tests, and the guard `internal-subpath-imports` keeps the helpers export out of production files. The public `createTenantDb` throws `AccessDeniedError` when its runner comes from `ctx.db.unsafeRaw()`, `ctx.db.unsafeRawAllTenants()` or `ctx.systemDb.unsafeRaw(reason)`, also for a transaction, savepoint or reserved connection opened on such a runner, and `scopeTenantDbToTenant` throws `AccessDeniedError` when it would move a tenant-mode handle to another tenant. Declared cross-tenant access stays on `r.systemScope()` with `ctx.systemDb.acknowledgeCrossTenant(reason)`, the escape hatch grant `crossTenantReads` with `ctx.crossTenantReads`, and `ctx.tenants.writeTarget(tenantId)`.
migration: Handlers, hooks and jobs that built `createTenantDb({ mode: "system", ... })` or `createTenantDb({ db: ctx.db.unsafeRaw(), tenantId })` for another tenant move to `r.systemScope()` with `ctx.systemDb.acknowledgeCrossTenant(reason)`, to `ctx.crossTenantReads` for reads, or to `ctx.tenants.writeTarget(tenantId)` for SystemAdmin writes into one tenant. Boot code, backfills and CLIs that hold a `DbConnection` call `createTenantDb({ db, tenantId })` once per target tenant. Tests that need `mode: "system"` or `grants` import `createTenantDb` from `@cosmicdrift/kumiko-testing/helpers`.
affects: createTenantDb, scopeTenantDbToTenant
-->
