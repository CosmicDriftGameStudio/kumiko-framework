---
status: reference
verified: 2026-08-01
evidence: "kumiko-framework#1630; kumiko-studio#154/1 → PR #162"
---

# Tier composition: boot-time vs. runtime half

`composeApp` (tier-engine) is the BOOT-TIME half of tier composition — which
features get mounted at all. The RUNTIME half, which features a given tenant
may see out of everything mounted, is `createTierEngineFeature`'s
`resolver(tenantId) => ReadonlySet<string>`. Both read the same `tierMap` at
opposite ends.

`composeApp` currently has no production callers, and that is not rot. Apps
use the resolver today; nobody composes per-tenant feature sets at boot yet,
so an app that only needs caps merges them locally rather than constructing a
featureRegistry it has no other use for (kumiko-studio's
`resolvePlatformCaps` — a deliberate, typed copy of `composeApp`'s cap-merge
step, not a workaround).

Whether the boot-time half ever gets a caller is a product question:
kumiko-studio's BYO pivot differentiates tiers by caps, not by feature set.
Delete `composeApp` only once no app plans to differentiate by feature set —
the engine itself is app-agnostic.
