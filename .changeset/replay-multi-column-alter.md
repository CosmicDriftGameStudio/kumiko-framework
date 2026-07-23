---
"@cosmicdrift/kumiko-framework": patch
---

schema-cli: fix `migration-content drift` false positives on multi-column `ALTER TABLE ... ADD COLUMN a, ADD COLUMN b` statements. The build-time replay used to match only the first `ADD COLUMN`/`DROP COLUMN` clause per statement — a migration adding several columns in one `ALTER TABLE` (a common hand-edit pattern, e.g. `0007_fix-secrets-table-columns`'s three-column fix) reported the later columns as missing even though the migration creates them. `applyStatement` now walks every comma-separated clause in the statement, in order.
