---
"@cosmicdrift/kumiko-framework": patch
---

`kumiko schema validate`'s migration-content-drift check (added in 0.162.0) false-positived on hand-edited `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `DROP COLUMN IF EXISTS` statements — legitimate post-generate hand-edits the generator itself never emits but explicitly allows. `replayMigrationsDir` now tolerates the optional `IF NOT EXISTS`/`IF EXISTS` clause.
