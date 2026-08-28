---
"@cosmicdrift/kumiko-framework": patch
---

Fix `migrate generate` silently swallowing an index predicate/column/uniqueness change into the new snapshot without emitting DDL. A same-name index whose `columns`, `unique`, `whereSql`, or `needsManualWhere` changed between snapshots is now detected as a table diff and rendered as `DROP INDEX` + `CREATE INDEX` (or left safely commented out when the new predicate needs manual review). Also fixes a related bug where a brand-new partial index with an unrenderable WHERE clause was emitted as a live, uncommented `CREATE INDEX` with the predicate silently dropped.
