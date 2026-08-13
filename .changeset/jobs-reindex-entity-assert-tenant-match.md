---
"@cosmicdrift/kumiko-bundled-features": patch
---

The `reindexEntity` job now reads through `ctx.systemDb.assertTenantMatch(ctx.systemUser.tenantId).raw` instead of raw `ctx.db` (fw#2079, part of the fw#2056 `systemScope()` migration). The per-tenant scoping still comes from the perTenant fan-out (one job-runner-enqueued child per active tenant); this only replaces the unchecked `ctx.db` read with the fail-closed self-check now that `JobContext.systemDb` is wired (fw#2105). Behavior is unchanged — `reindexEntity()` still filters `WHERE tenant_id = $1` with the same tenant.
