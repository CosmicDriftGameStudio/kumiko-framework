---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

Review fixes for the pipeline, jobs and db layers: savepoint chains no longer leak into background tasks, member-resolution reads lose their write-capable services, batch hooks only build a context when hooks exist, and the oversized pipeline, job-runner and server-route files are split.

<!-- kumiko-changes
feature: framework
type: fix
title: pipeline review fixes (savepoint scope, member-read services, batch hooks, file splits)
detail: A savepoint opened by a background task after its parent savepoint ended now queues on the transaction's root chain instead of the stale nested chain, so it can no longer overlap sibling savepoints (3B001). Queries running as a resolved member principal lose kms, masterKeyProvider and the escape-hatch audit sink, and secrets only allows get and has. Dispatcher batches skip building the batch-hook context when no postSaveBatch/postDeleteBatch hook is registered (new LifecycleHooks.hasBatchHooks). Invalid-datetime errors mapped to a 400 now leave a warn log. The Bun.SQL connection error codes are shared between the event dispatcher and wait-for-database. dispatch-write, handler-context-events, job-runner-context and server-routes were split into single-purpose files without behavior change.
-->
