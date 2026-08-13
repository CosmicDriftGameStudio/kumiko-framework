---
"@cosmicdrift/kumiko-bundled-features": patch
---

`config`'s `values`, `cascade`, and `readiness` query handlers now read through `ctx.systemDb.assertTenantMatch(...)` instead of raw `ctx.db` (fw#2071, part of the fw#2056 `systemScope()` migration). Pure pattern migration — `assertTenantMatch` is a self-check on the caller's own tenant (always the dispatching user's tenantId by construction), not a new query filter, so behavior and access are unchanged. `buildProviderSelectionGate` and `collectMissingRequiredConfig` (shared with the separate `readiness` feature's status handler) now take the already-scoped `db: TenantDb` as an explicit required parameter instead of resolving it internally, so each caller keeps its own scope decision self-contained.
