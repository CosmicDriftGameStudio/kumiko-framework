---
"@cosmicdrift/kumiko-framework": minor
---

**BREAKING (retroactive note, fw#1598):** the `read_*`-prefix rejection in `assertUnmanagedTableName` (added in `0.165.2`, released as a *patch*) is a breaking change for any consumer calling `buildEntityTableMeta(name, entity, { source: "unmanaged" })` without an explicit `entity.table` — such a call used to silently default to a `read_*` table name and now throws at module-import time. If you hit `assertUnmanagedTableName` throwing after an update, set an explicit `table: "store_*"` (or another non-`read_`-prefixed name) on the affected `createEntity`/`defineUnmanagedTable` call.
