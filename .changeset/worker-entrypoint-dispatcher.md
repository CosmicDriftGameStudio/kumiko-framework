---
"@cosmicdrift/kumiko-framework": minor
---

`createWorkerEntrypoint` now returns the command-dispatcher, the same handle `createApiEntrypoint` has always exposed — a worker builds the identical server, only without routes, so the dispatcher was there all along and just unreachable. App-wired components that run in the worker process and have to persist their result need it: `JobContext` deliberately has no `write`/`query`, and persisting goes through the write-path.
