---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-testing": patch
---

The unused entity cache is removed.

<!-- kumiko-changes
feature: framework
type: breaking
title: Entity cache removed
detail: `createEntityCache`, `EntityCacheOptions`, the `EntityCache` type with its `@cosmicdrift/kumiko-types/entity-cache` subpath, `ctx.services.entityCache`, `AppContext.entityCache` and the `entityCache` option of `createEventStoreExecutor` are removed. No handler, executor or app passed the cache to an executor, so `detail`, `list` and the write verbs never used it in production, and a cache hit would still have needed the ownership and stream-version probe on the database. `runProdApp`, the worker boot and the test stack no longer build it, and nothing writes the Redis prefix `kumiko:cache:` any more.
migration: Remove `entityCache` from hand-built `AppContext` objects and from `createEventStoreExecutor` options. Code that read `ctx.services.entityCache` reads the row through the executor or a query handler.
-->
