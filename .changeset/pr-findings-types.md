---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

Type reconciliation: `FeatureDefinition.entities/hooks/entityHooks` and every slot of `HookMap`/`EntityHookMap` are now optional (`?:`) — matching the documented runtime contract (hand-built definitions at system boundaries omit slots; the registry guards against that, pinned by the "slot robustness" tests since #95/#98/#210). The previous required typing was a compiler lie that forced `?.`/`?? {}` guards to contradict the types. All production read-sites now guard explicitly; the single remaining `as HookMap` in defineFeature is the documented engine-bridge for the per-slot signature erasure in hook registration.
