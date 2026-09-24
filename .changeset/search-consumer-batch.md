---
"@cosmicdrift/kumiko-framework": minor
---

`EventConsumer` can now wire an optional `batchHandler` that receives a whole delivery turn's events at once, with automatic per-event fallback when the batch throws. The search-index consumer uses it to collapse a turn's events to one `indexBatch`/`removeBatch` call per tenant instead of one round-trip per event. The Meilisearch adapter now throws when a task ends in a status other than `succeeded` (e.g. a rejected document id); `waitTask()` resolves on failed tasks, so these writes used to fail silently and the consumer cursor moved past unindexed documents. A remove on a tenant without an index still succeeds (`index_not_found` counts as removed). Ops note: a document Meilisearch rejects now halts the search consumer and dead-letters it after `errorPolicy.maxAttempts` instead of being skipped silently; recover with `skipPoisonEvent`.

<!-- kumiko-changes
feature: framework
type: improvement
title: EventConsumer.batchHandler — turn-level batching with per-event fallback, used by the search consumer
-->
