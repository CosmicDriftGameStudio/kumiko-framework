---
"@cosmicdrift/kumiko-framework": patch
---

A search reindex no longer writes text back that was deleted or edited while it ran.

<!-- kumiko-changes
feature: framework
type: fix
title: reindexEntity reconciles each written batch against the live table
detail: After a batch is written, reindexEntity reads the same ids again. Rows that vanished or were soft-deleted leave the index, rows whose version changed since the read are rewritten from the fresh row (or leave the index when they are erased by then). Before, a delete, purge or edit processed by the live search consumer between the read and the write of a batch could put the old text back. ReindexEntityOptions gets afterBatchRead, a hook that runs between reading and writing a batch.
-->
