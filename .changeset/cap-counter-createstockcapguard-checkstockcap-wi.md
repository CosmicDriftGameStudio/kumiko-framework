---
"@cosmicdrift/kumiko-bundled-features": minor
---

createStockCapGuard/checkStockCap/withStockCap resolve through the caller's TenantDb, not a raw DbRunner + explicit tenantId (fw#2854).

`createStockCapGuard`'s resolver is now `(db: TenantDb) => Promise<TCaps>` instead of `(db: DbRunner, tenantId: TenantId) => Promise<TCaps>`. `checkStockCap(db: TenantDb, spec)` drops the separate `tenantId` parameter — the tenant comes from `db.tenantId`, and the count runs through `TenantDb.count` instead of the raw `countWhere`. `StockCapSpec.table` is now typed `SchemaTable | EntityTableMeta` (matching `TenantDb.count`'s table parameter) instead of `Parameters<typeof countWhere>[1]`. `withStockCap` no longer declares an `escapeHatch` on the wrapped handler and no longer reads through `ctx.db.unsafeRaw(...)` — it calls `checkStockCap(ctx.db, spec)` directly, so a `TenantAdmin`-only handler with no `escapeHatch` can use it.

<!-- kumiko-changes
feature: cap-counter
type: breaking
title: createStockCapGuard/checkStockCap/withStockCap resolve through the caller's TenantDb, not a raw DbRunner + explicit tenantId (fw#2854).
migration: |
  `createStockCapGuard(async (db, tenantId) => ...)` → `createStockCapGuard(async (db) => ...)`, reading `db.tenantId` instead of the removed second argument. A direct `checkStockCap(runner, tenantId, spec)` call → `checkStockCap(tenantDb, spec)` with a `TenantDb` built via `createTenantDb(runner, tenantId)` (or `ctx.db` inside a handler). If your wrapped handler relied on `withStockCap`'s auto-added `escapeHatch` for some other reason, declare it explicitly on the handler instead — `withStockCap` no longer adds one.
-->
