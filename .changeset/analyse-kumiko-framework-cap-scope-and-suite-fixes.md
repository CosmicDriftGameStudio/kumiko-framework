---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
---

`enforceCap` and `assertBelowHardCap` take an optional `scope` ("tenant" or "subject"); when set, `CapExceededError` carries it as `details.scope`, so a client can tell a per-user limit from the tenant limit. Parallel `reportIngestProgress` calls for a new file no longer fail on the primary key: the progress row gets a random id and the unique index on tenant and file is the only key in play. The live-events `online` listener is removed through its own window reference, so a cleanup after teardown no longer throws.
