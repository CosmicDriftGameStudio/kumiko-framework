---
"@cosmicdrift/kumiko-framework": patch
---

Enforce the archived-stream read-only contract on the CRUD executor path. `update`, `delete`, and `restore` now reject writes onto an archived aggregate with `ArchivedStreamError` (rolled-back transaction, no event lands) — matching the existing `ctx.appendEvent` behaviour. Previously these went through `append()` + `getStreamVersion()`, which ignore the archive flag, so entity-CRUD writes could silently land events on an archived stream while `loadAggregate` returned an empty slice for the same stream.
