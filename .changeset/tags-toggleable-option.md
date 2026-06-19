---
"@cosmicdrift/kumiko-bundled-features": minor
---

tags: `createTagsFeature` accepts a `toggleable` option so the whole feature can
be tier-gated through the framework's own machinery — no host-side entity hook.
Pass `createTagsFeature({ toggleable: { default: false } })` and list the feature
name (`tags`) in the entitling tiers' `TierMap`; the tier-engine + feature-toggles
then enable/disable every tag write/read path per tenant (fail-closed below the
tier). Omitting `toggleable` keeps tags always-on (unchanged default).
