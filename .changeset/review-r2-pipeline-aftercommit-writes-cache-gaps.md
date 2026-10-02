---
"@cosmicdrift/kumiko-framework": patch
---

Writes from an afterCommit hook now run as their own transaction with their own afterCommit flush, so the nested write's hooks fire and a failing projection rolls it back. The tenant timezone cache no longer stores a value read before a concurrent config write. Nested-write ownership checks complete a partial parent row from the stored row. `skipPoisonEvent` locks the consumer row before computing pending gaps. The search consumer fails an event for retry when its context has no database instead of removing the index entry.

<!-- kumiko-changes
feature: framework
type: fix
title: afterCommit hook writes run in their own transaction, plus cache, nested-write, skip-poison and search-consumer fixes
-->
