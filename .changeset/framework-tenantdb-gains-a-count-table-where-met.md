---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

TenantDb gains a count(table, where?) method for a tenant-scoped COUNT(*) (fw#2854).

`TenantDb.count(table, where?)` returns a tenant-scoped row count with the same tenant semantics as `selectMany`: "tenant" mode counts the caller's own tenant plus `SYSTEM_TENANT_ID` reference rows, a caller-supplied `where.tenantId` may only narrow that scope, and "system" mode counts unfiltered. Lets app/feature code compute stock-caps (`count(*) WHERE tenant_id = …`) without an `unsafeRaw`/`escapeHatch` detour. A hand-built `TenantDb` object literal (test fakes, mocks) must add a `count` method to keep satisfying the `TenantDb` type — `db.global()` is unaffected, `count` is only on the tenant-scoped surface.

<!-- kumiko-changes
feature: framework
type: improvement
title: TenantDb gains a count(table, where?) method for a tenant-scoped COUNT(*) (fw#2854).
migration: |
  No action required for existing `TenantDb` consumers — purely additive. Any hand-built object literal typed as `TenantDb` (not built via `createTenantDb`) needs a `count(table, where?)` method added; `bunCountWhere`/`countWhere` from `@cosmicdrift/kumiko-framework/db` implements the same query shape if you need equivalent logic outside a `TenantDb`.
-->
