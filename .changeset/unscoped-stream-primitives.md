---
"@cosmicdrift/kumiko-framework": minor
---

Renamed `getAggregateStreamMaxVersion` → `getUnscopedAggregateStreamMaxVersion` and `getAggregateStreamTenant` → `getUnscopedAggregateStreamTenant` (both from `@cosmicdrift/kumiko-framework/event-store`). Both have no tenant filter and can be used to probe whether a foreign tenant's aggregate exists — the rename makes that unscoped, existence-oracle nature visible at every callsite. No behavior change; update any direct imports to the new names (#1269).
