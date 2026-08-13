---
"@cosmicdrift/kumiko-bundled-features": patch
---

`delivery`'s `log` query handler now reads through `ctx.systemDb.assertTenantMatch(...)` instead of raw `ctx.db` (fw#2074, part of the fw#2056 `systemScope()` migration). Pure pattern migration — the explicit `where: { tenantId }` filter stays, since `assertTenantMatch` is a self-check on the caller's own tenant, not a query filter. Behavior and access are unchanged.
