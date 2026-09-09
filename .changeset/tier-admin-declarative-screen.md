---
"@cosmicdrift/kumiko-bundled-features": minor
---

`tier-engine`'s `tier-admin` screen is now a declarative `actionForm` (a `reference` field for the tenant, a `select` field for the tier) instead of a custom React component: it dispatches `set-tenant-tier` directly, so the renderer's generic form handles tenant lookup, validation and submit.

Two behaviors are intentionally not carried over from the old custom screen: the current tier of the selected tenant is no longer shown before submit (no dependent-query support in declarative forms), and the success state no longer names the newly assigned tier (a generic actionForm success doesn't surface write-response data). Both are visible again after a page reload / re-navigation, since the assignment itself is unchanged.

Removed export (dead since the renderer selects screens by `screen.type`, not the client component registry): `TierAdminScreen` from `@cosmicdrift/kumiko-bundled-features/tier-engine/web`. No shipped consumer app imported it directly — all reference the screen only by its qualified id `tier-engine:screen:tier-admin`.
