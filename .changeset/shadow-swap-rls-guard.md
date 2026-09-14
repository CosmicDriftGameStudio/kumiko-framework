---
"@cosmicdrift/kumiko-framework": patch
---

Fix: projection and MSP rebuild now abort instead of silently dropping row level security from the live table. The shadow swap rebuilds the table from `EntityTableMeta`, which carries no RLS/policy information, so a live table with RLS enabled/forced or any policy would previously lose all of it on cutover. Both rebuild paths now reject up-front (and again right before the swap) with the table name and policy count; `replayMigrationsDir` also recognizes `FORCE`/`NO FORCE ROW LEVEL SECURITY` as shape-neutral DDL instead of failing loud.
