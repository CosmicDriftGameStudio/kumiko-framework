---
"@cosmicdrift/kumiko-framework": patch
---

`kumiko schema generate` now writes an executable `DROP TABLE IF EXISTS "read_job_runs";` for retired framework tables (new `retiredFrameworkTables` list next to the migration code). Until now the drop stayed a commented `-- DESTRUCTIVE:` marker in every app, so the table lived on forever. A retired table is dropped only if an earlier migration created it or carries the commented drop, no earlier migration dropped it for real, and the schema no longer declares it. App tables stay commented out. `generate` writes a migration even when the retired drop is its only content, and `schema validate` reports it as pending. `kumiko schema status` now lists tables that a migration only drops as a commented marker but that still exist in the database, with a hint per case.

<!-- kumiko-changes
feature: framework
type: fix
title: Retired framework tables (read_job_runs) are dropped by the next schema generate
migration: |
  Run `kumiko schema generate <name>` in publicstatus, solon, money-horse, phronexsis, show-pony and kumiko-studio, review and commit the drop of read_job_runs (old job run history is not preserved), then apply.
-->
