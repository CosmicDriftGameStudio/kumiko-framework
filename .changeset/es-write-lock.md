---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-guards": patch
---

Event-fed tables (r.entity and r.projection) reject direct writes at runtime. Only the entity executor, projection apply and rebuild, declared unsafe projection steps, tenant-destroy hooks and the new deleteRowsWithoutReplayableStream helper may write them. unsafeRaw() no longer unlocks them.

<!-- kumiko-changes
feature: framework
type: breaking
title: Direct writes on event-fed tables throw at runtime
detail: buildEntityTable and r.projection mark their tables. insertOne, updateMany, deleteMany, the upsert and counter helpers, ctx.db write methods and db.global() writes throw AccessDeniedError on a marked table unless the runner carries the framework write capability. The executor, projection apply, rebuild, unsafeProjectionDelete, tenant-destroy hooks and deleteRowsWithoutReplayableStream hold it; ctx.db.unsafeRaw() never does. Retention deletes only rows whose stream is gone or archived. The cascade delete hook, the soft-delete purge jobs and seedReferenceData now write through the executor, so their effect survives a rebuild; cascade children are written as the system user, and softDelete children are soft-deleted instead of hard-deleted. The direct-entity-writes guard has no exceptions left.
migration: Write event-fed rows through the executor (r.crud, ctx.write, createEventStoreExecutor). Projection apply functions must use the db they receive. Test seeds and teardown use seedRow, seedRows, updateRows, deleteRows and clearTables from kumiko-testing instead of hand-written wipe helpers. Do not pass ctx.db.unsafeRaw() to code that deletes event-fed rows; pass ctx.db inside a tenant-destroy hook. Retention code calls deleteRowsWithoutReplayableStream after pruning or archiving the events. seedReferenceData takes the registry instead of a table map. Affects kumiko-enterprise, kumiko-studio and solon.
-->
