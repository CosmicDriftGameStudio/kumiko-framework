---
"@cosmicdrift/kumiko-types": minor
---

The unused `KumikoEntityTypeMap`, `KumikoHandlerPayloadMap` and `KumikoHandlerResultMap` interfaces are removed from `@cosmicdrift/kumiko-types/event-type-map`.

<!-- kumiko-changes
feature: types
type: breaking
title: Unused entity, handler payload and handler result type maps removed
detail: `KumikoEntityTypeMap`, `KumikoHandlerPayloadMap` and `KumikoHandlerResultMap` were empty declaration-merging markers that nothing read and no app augmented; the code-generation script their comment promised does not exist. `KumikoEventTypeMap` stays and still types `ctx.events.append` for apps that augment it.
migration: None known. Code that augments one of the three removed interfaces deletes that `declare module` block.
affects: KumikoEntityTypeMap, KumikoHandlerPayloadMap, KumikoHandlerResultMap
-->
