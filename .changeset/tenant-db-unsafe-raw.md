---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`ctx.db.unsafeRaw(reason)` returns the unfiltered runner only for write/query handlers and hooks that declare `escapeHatch: { reason }`. `tenancy: "global"` entities must be `systemStream` and only hold `SYSTEM_TENANT_ID` rows; `declareGlobalTenancy(table)` declares plain stores without `tenant_id` as global. `createTenantDb`'s 7th parameter is now `{ globalWrites?, unsafeRaw? }`. Bundled features no longer use `ctx.db.raw` (`user` and `store_global_feature_state` are global); `scripts/migrate-db-raw.ts` migrates consumer call sites.
