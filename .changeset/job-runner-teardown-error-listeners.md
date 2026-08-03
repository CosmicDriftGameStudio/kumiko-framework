---
"@cosmicdrift/kumiko-framework": patch
---

`createJobRunner` now attaches an `error` listener to every Redis/BullMQ connection it owns (lock connection, api/worker queues, worker) and awaits `worker.waitUntilReady()` before returning from `start()`. Without the listeners, a post-close `error` event went unhandled and crashed the process; without the await, a `stop()` right after `start()` raced the still-settling worker connection and rejected its in-flight commands with an unlistenable "Connection is closed." In `bun:test` both surfaced as an unhandled error attributed to whichever unrelated test ran next (fw#1805).
