---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
---

`enforceCap` and `assertBelowHardCap` take an optional `scope` ("tenant" or "subject"); when set, `CapExceededError` carries it as `details.scope`, so a client can tell a per-user limit from the tenant limit. Parallel `reportIngestProgress` calls for a new file no longer fail on the primary key: the progress row gets a random id and the unique index on tenant and file is the only key in play. The live-events `online` listener is removed through its own window reference, so a cleanup after teardown no longer throws.

<!-- kumiko-changes
feature: cap-counter
type: improvement
title: Cap errors carry an optional scope
detail: `enforceCap` and `assertBelowHardCap` take an optional `scope` ("tenant" or "subject"); when set, `CapExceededError` carries it as `details.scope`, so a client can tell a per-user limit from the tenant limit.
-->

<!-- kumiko-changes
feature: document-ingest-foundation
type: fix
title: Parallel first progress reports of a file no longer collide
detail: Parallel `reportIngestProgress` calls for a new file no longer fail on the primary key: the progress row gets a random id and the unique index on tenant and file is the only key in play.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Live-events cleanup after teardown no longer throws
detail: The live-events `online` listener is removed through its own window reference, so a cleanup after teardown no longer throws.
-->
