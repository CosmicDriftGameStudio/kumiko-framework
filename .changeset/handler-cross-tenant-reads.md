---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Handlers and jobs can read across tenants without taking the raw runner.

<!-- kumiko-changes
feature: framework
type: improvement
title: ctx.crossTenantReads for handlers with the crossTenantReads grant
detail: A handler whose `escapeHatch` lists `grants: ["crossTenantReads"]` (or `unsafeRaw`, which implies it) gets `ctx.crossTenantReads` with `selectMany`, `fetchOne` and `count`, unfiltered by tenant and including the events table. Every call is audited as `cross-tenant-read`; `ctx.db.unsafeRaw()` stays denied for the read-only grant, and neither a member-resolution read nor an agent tool call (`dispatchToolCall`, including handlers it reaches through nested `ctx.query`/`ctx.write`) ever receives the surface, so cross-tenant rows cannot reach an LLM context. Jobs use the same grant. The internal `runAsDirectCallEntry` (`/internal/request-context`) now also marks its scope as an agent tool call. Without the grant nothing changes.
-->

<!-- kumiko-changes
feature: types
type: improvement
title: RawDbClient is typed instead of any
detail: `RawDbClient.unsafe` and `begin` have real signatures, so `db.unsafe(...)` on a `DbConnection` no longer collapses to `any`. A hand-built fake runner needs `unsafe(sql, params?)` returning rows and a `begin` that takes a callback.
-->
