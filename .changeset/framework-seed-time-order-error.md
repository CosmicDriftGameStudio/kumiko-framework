---
"@cosmicdrift/kumiko-framework": patch
---

Seed writes before their stream predecessor throw SeedTimeOrderError, checked inside the write transaction

<!-- kumiko-changes
feature: framework
type: improvement
title: Back-dated seed writes fail with a typed SeedTimeOrderError
detail: append() throws the exported SeedTimeOrderError (aggregateType, aggregateId, version, seedCreatedAt, predecessorCreatedAt) when a back-dated event would precede its stream predecessor, so seeders can tell it from other failures without parsing the message. The check now runs inside the insert transaction, so a concurrent live append can no longer land between check and insert.
-->
