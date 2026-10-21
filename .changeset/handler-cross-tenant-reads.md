---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": patch
---

Handlers and jobs can read across tenants without taking the raw runner.

<!-- kumiko-changes
feature: framework
type: improvement
title: ctx.crossTenantReads for handlers with the crossTenantReads grant
detail: A handler whose `escapeHatch` lists `grants: ["crossTenantReads"]` (or `unsafeRaw`, which implies it) gets `ctx.crossTenantReads` with `selectMany`, `fetchOne` and `count`, unfiltered by tenant and including the events table. Every call is audited as `cross-tenant-read`; `ctx.db.unsafeRaw()` stays denied for the read-only grant, and a member-resolution read never receives the surface. Jobs use the same grant. Without the grant nothing changes.
-->

<!-- kumiko-changes
feature: types
type: improvement
title: RawDbClient is typed instead of any
detail: `RawDbClient.unsafe` and `begin` have real signatures, so `db.unsafe(...)` on a `DbConnection` no longer collapses to `any`. A hand-built fake runner needs `unsafe(sql, params?)` returning rows and a `begin` that takes a callback.
-->
