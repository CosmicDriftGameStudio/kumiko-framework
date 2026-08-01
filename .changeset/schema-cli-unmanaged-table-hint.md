---
"@cosmicdrift/kumiko-framework": patch
---

`kumiko-schema validate`'s migration-content drift check now points an `unexpected-table` mismatch at `table()`/`defineUnmanagedTable()` + `r.storeTable()` instead of suggesting a hand-fix of the SQL file — the established way to register a raw/hand-written table so it flows into `ENTITY_METAS` and `.snapshot.json`.
