---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Add `r.uiHints({...})` for picker/scaffolder metadata

Features can now declare optional UI metadata via `r.uiHints({ displayLabel, category, recommended, configurableOptions })`. The hints flow through `defineFeature` into `FeatureDefinition.uiHints` and into `feature-manifest.json` under `feature.uiHints`. Pure manifest-side info — the framework runtime does not read it. Consumers (the upcoming `bun create kumiko-app` picker, the docs feature-reference) treat absent hints as "no special treatment" and fall back to `name` + `description`. Eight picker-MVP bundled features carry hints out of the box (`auth-email-password`, `tenant`, `user`, `sessions`, `delivery`, `files`, `billing-foundation`, `feature-toggles`); the remaining bundled features remain unannotated and will be filled in alongside the picker work. Additive — no breaking changes.
