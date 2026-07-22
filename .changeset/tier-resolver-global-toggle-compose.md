---
"@cosmicdrift/kumiko-bundled-features": minor
---

feature-toggles: add `composeTierResolverWithGlobalToggles` to combine a tier-engine `tenantTierResolver` with a global `GlobalFeatureToggleRuntime` into a single `effectiveFeatures` resolver. Apps running both tier-engine (per-tenant feature cuts) and feature-toggles (global operator switches, e.g. a runtime kill-switch not tied to any tier) previously had no way to compose them — the framework only auto-wires one `tenantTierResolver` plugin. The global layer only narrows what the tier grants (an explicit `enabled:false` row removes a feature; no row or `true` leaves the tier's grant untouched) — it never falls back to a toggleable feature's own default, which would otherwise silently disable every tier-gated toggleable feature the moment feature-toggles gets composed in. Also adds `GlobalFeatureToggleRuntime.readOverride(name)` for the raw per-feature override, bypassing the requires() cascade.
