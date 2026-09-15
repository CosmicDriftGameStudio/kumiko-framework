---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`TenantDb` gains a `count(table, where?)` method (tenant-scoped `COUNT(*)`, same semantics as `selectMany`) — hand-built `TenantDb` objects must add it. `tier-engine`'s `resolveTier`/`resolveTierCaps` now take only a `TenantDb` (no separate `tenantId` argument, so a foreign tenant can no longer be requested) and `cap-counter`'s `createStockCapGuard`/`checkStockCap`/`withStockCap` resolve through the caller's own `TenantDb` instead of a raw `DbRunner` + explicit `tenantId` — `withStockCap` no longer needs to declare an `escapeHatch`. `cap-counter` also gains in-process booking helpers `bookCapUsage`, `markCapSoftWarned`, `bookRollingCapUsage` and `readRollingCapUsage`, bound to the caller's own tenant: `enforceCapAndMaybeNotify`/`withCapEnforcement`/`withRollingCapEnforcement` now work for a plain `TenantAdmin` caller without a `SystemAdmin` identity-switch or `escapeHatch`.
