---
"@cosmicdrift/kumiko-bundled-features": minor
---

Cap limits can come from runtime config

`CapSpec.limit(tier, { config })` may now be async and receives the calling handler's config accessor; `caps:usage` and `tenant-caps:list` await it (the list resolves each cap/tier pair once per page). `createTierResolver`'s `capsForTier(tier, { config })` may return a Promise and `resolveTierCaps(db, context?)` forwards the context; `createStockCapGuard`'s resolver receives `{ config }`, which `withStockCap` fills from `ctx.config`. Existing sync one-argument implementations keep working. The accessor is bound to the caller's tenant, so tier-wide limits belong in system-scoped config keys.

<!-- kumiko-changes
feature: cap-overview
type: improvement
title: Cap limits can come from runtime config
detail: |
  `CapSpec.limit(tier, { config })` may return a Promise and gets the caller's config accessor, so a SystemAdmin-editable config key can drive a tier's limit shown by caps:usage and tenant-caps:list. tier-engine's `capsForTier` and cap-counter's `createStockCapGuard` resolver receive the same `{ config }` context (`CapLimitContext`), so enforcement can read the same key. Sync implementations keep working; use system-scoped keys for tier-wide limits.
-->
