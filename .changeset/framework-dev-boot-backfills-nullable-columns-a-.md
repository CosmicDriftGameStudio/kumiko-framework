---
"@cosmicdrift/kumiko-framework": patch
---

Dev-boot backfills nullable columns a persistent dev DB is missing

pushEntityProjectionTables (used by runDevApp/createKumikoServer and setupAppTestStack) skipped every table that already existed, even when the entity definition had grown new columns since the table was created — a persistent dev DB (KUMIKO_DEV_DB_NAME) needed the column added by hand. It now diffs the live columns against the entity's current column set and runs ALTER TABLE ADD COLUMN for anything nullable or defaulted. A missing required column with no default can't be added safely once the table may hold rows, so that case still fails boot, now with a message naming the exact column and telling the dev to drop the persistent dev DB so the next boot recreates it.

<!-- kumiko-changes
feature: framework
type: fix
title: Dev-boot backfills nullable columns a persistent dev DB is missing
detail: |
  `pushEntityProjectionTables` (packages/framework/src/stack) now diffs an
  existing implicit-projection table's live columns against the entity's
  current column set via `columnNamesOf`, backfilling anything nullable or
  defaulted through the newly extracted `addMissingColumns` helper (shared
  with `unsafePushTables`'s existing column-diff loop). A missing required
  column with no default throws instead, naming the column and the
  persistent dev DB (`KUMIKO_DEV_DB_NAME`) to drop so the next boot
  recreates it. Covers implicit `r.entity()`-derived projection tables,
  which is what the reporting app's read-model table used. `setupTestStack`'s
  own explicit `r.projection()`/`r.storeTable()` push loop (test-stack.ts)
  has the same skip-existing behavior and is not yet patched.
-->
