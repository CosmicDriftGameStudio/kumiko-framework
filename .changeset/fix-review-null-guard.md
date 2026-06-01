---
"@cosmicdrift/kumiko-framework": patch
---

Complete the `createRegistry` null-guard pass (#98) on seven `feature.*` slot
accesses the mass-fix missed: `feature.hooks`/`entityHooks` property access,
the `extensionUsages`/`referenceData`/`configSeeds` spreads, `Object.values`
over `secretKeys`/`claimKeys`, and the `authClaimsHooks`/`requires` loops now
all tolerate undefined slots, matching the surrounding `?? {}` / `?? []`
convention.

`defineFeature` always populates these fields, so this changes no behaviour for
features built through the public API — it hardens the hand-built
`FeatureDefinition` escape hatch (already documented at the `claimKeys` site)
against `Cannot read properties of undefined` / `TypeError: not iterable`.
