---
"@cosmicdrift/kumiko-framework": patch
---

Five review fixes: where operators with no defined operand throw, events prune matches kebab-case aggregate types, the ES operations table creation no longer deadlocks small pools, read-model access rules are checked at boot, and search reindex drops rows erased during a batch.

<!-- kumiko-changes
feature: framework
type: fix
title: review fixes for where operators, events prune, ES ops table, read-model access boot check and search reindex
detail: An operator object whose operands are all undefined (`{ id: { in: undefined } }`) or a non-array `in`/`notIn` now throws instead of dropping the WHERE and turning `deleteMany` into a whole-table delete. `kumiko events prune` compares aggregate types and projection sources kebab-normalised, so `document-extract` matches a `documentExtract` source and is not reported unknown. `createEsOperationsTable` runs its re-check and DDL on a sibling pool, so a lock transaction no longer deadlocks at `DATABASE_POOL_MAX=1`. `validateOwnershipBoot` and `validateOwnershipRules` also validate the `access` of projection read-model entities. Search reindex reconcile removes unchanged rows whose subject key was erased after the batch read.
-->
