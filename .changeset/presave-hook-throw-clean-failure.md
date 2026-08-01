---
"@cosmicdrift/kumiko-framework": patch
---

A `preSave` hook that throws no longer crashes the write with an uncaught `internal_error` 500. `EventStoreExecutor.create`/`.update` now catch the hook and map it to a clean `writeFailure` (`presave_hook_failed`, `errors.presaveHookFailed`), carrying the hook's error message in `error.details.message`.
