---
"@cosmicdrift/kumiko-framework": patch
---

`rebuildTablesFromDiff` now only marks `changedTables` with `newColumns.length > 0` for rebuild. Previously every table touched by the diff (even index-only, nullability-only, default-only or drop-only changes) was added to the marker — but those don't need a projection rebuild, the generated `ALTER`/`CREATE INDEX` SQL alone brings the table to the target state. Avoids expensive full-replay (truncate + replay all events) on large streams for changes the SQL already handles.

`readRebuildMarker` now validates `version === MARKER_VERSION` before reading `tables`, matching the snapshot-loader's contract. A future v2 marker is no longer silently interpreted as v1.
