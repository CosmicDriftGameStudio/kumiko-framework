---
"@cosmicdrift/kumiko-framework": minor
---

`defineEntityWriteHandler` and `defineEntityQueryHandler` are no longer exported from `@cosmicdrift/kumiko-framework/engine`.

<!-- kumiko-changes
feature: framework
type: breaking
title: Entity handlers with the verb in the name string are internal
detail: `defineEntityWriteHandler("note:create", ...)` and `defineEntityQueryHandler("note:list", ...)` were a third public way to register entity handlers next to `r.crud` and the verb factories, and only the search recipe used them. They are no longer exported from `@cosmicdrift/kumiko-framework/engine`. The verb factories `defineEntityCreateHandler`, `defineEntityUpdateHandler`, `defineEntityDeleteHandler`, `defineEntityRestoreHandler`, `defineEntityListHandler` and `defineEntityDetailHandler` build the same handlers with the same parent-ref brand.
migration: Replace `defineEntityWriteHandler("<entity>:<verb>", entity, options)` with the factory of that verb, `defineEntity<Verb>Handler("<entity>", entity, options)`, and `defineEntityQueryHandler` with `defineEntityListHandler` or `defineEntityDetailHandler`.
-->
