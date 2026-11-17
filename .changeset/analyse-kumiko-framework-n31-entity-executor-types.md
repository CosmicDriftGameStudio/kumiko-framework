---
"@cosmicdrift/kumiko-framework": minor
---

`@cosmicdrift/kumiko-framework/db` exports `EntityRow` and `EntityExecutorOf`.

<!-- kumiko-changes
feature: framework-core
type: feature
title: EntityRow and EntityExecutorOf exports
detail: `EntityRow<typeof entity>` is the row type of an entity and `EntityExecutorOf<typeof entity>` is the executor type `createEntityExecutor` returns, so apps no longer declare `Record<string, unknown>` row aliases.
-->
