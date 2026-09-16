---
"@cosmicdrift/kumiko-bundled-features": minor
---

createTierResolver's resolveTier/resolveTierCaps take only a TenantDb — no separate tenantId argument (fw#2854).

`resolveTier(db)` and `resolveTierCaps(db)` (from `createTierResolver`) now read the tenant from `db.tenantId` instead of taking a second `tenantId` parameter, so a caller can no longer pass a `TenantDb` for one tenant alongside a different `tenantId` and resolve a foreign tenant's tier.

<!-- kumiko-changes
feature: tier-engine
type: breaking
title: createTierResolver's resolveTier/resolveTierCaps take only a TenantDb — no separate tenantId argument (fw#2854).
migration: |
  `resolveTier(ctx.db.raw|runner, tenantId)` → `resolveTier(ctx.db)` (same for `resolveTierCaps`). Outside a handler: `resolveTier(createTenantDb(runner, tenantId))`.
-->
