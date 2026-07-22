---
"@cosmicdrift/kumiko-bundled-features": patch
---

feature-toggles: fix `composeTierResolverWithGlobalToggles` to actually grant tier-unaware toggleable features. The previous version only ever narrowed the tier resolver's own set — a toggleable feature that no tier's `features` list mentions at all (e.g. a pure operator kill-switch like a self-registration toggle, never differentiated by plan) could never appear, regardless of its declared default or an explicit `true` override, because narrowing can only remove names, never add ones the tier never granted. Now takes a third `registry` argument and unions in `computeEffectiveFeatures`' normal cascade for every feature name absent from `tierResolver(SYSTEM_TENANT_ID)` (the tier-managed set) — tier-managed toggleables keep the narrow-only semantics from before, tier-unaware ones are governed purely by their own default/override.
