---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-feature-ast": patch
---

`ctx.db.unsafeRaw()` keeps the tenant's row level security scope; `ctx.db.unsafeRawAllTenants()` reaches every tenant.

<!-- kumiko-changes
feature: framework
type: breaking
title: ctx.db.unsafeRaw() stays in the caller's tenant
detail: A granted `ctx.db.unsafeRaw()` used to run in the system scope of row level security, so raw SQL with a forgotten tenant_id filter read and wrote rows of every tenant. It now runs in the scope of its TenantDb: the caller's tenant (plus system tenant rows on tables that allow reading them) in tenant mode, the system scope in system mode. The new `ctx.db.unsafeRawAllTenants()` returns the old all-tenants runner under the same `unsafeRaw` grant and audit. `ctx.systemDb.unsafeRaw(reason)` is unchanged. `ConnectionTenantDb` has both methods.
migration: Run kumiko-upgrade --apply; the unsafe-raw-all-tenants codemod renames every `.unsafeRaw()` call without arguments to `.unsafeRawAllTenants()`, which keeps today's behaviour. Hand-written TenantDb stubs it lists need an `unsafeRawAllTenants` member. Switch a call back to `unsafeRaw()` where its SQL only touches the caller's own tenant.
affects: unsafeRaw, TenantDb
codemod: scripts/codemod/unsafe-raw-all-tenants.ts
-->
