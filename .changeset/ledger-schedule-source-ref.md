---
"@cosmicdrift/kumiko-bundled-features": minor
---

Ledger schedules get an optional, filterable `sourceRef` field

`scheduleEntity` (`read_ledger_schedules`) gains `sourceRef`, a caller-assigned stable key (max 128 chars) for finding a schedule again, for example one per lease position. `description` can then stay plain display text instead of doubling as a lookup key. Filter the schedule list with `{ field: "sourceRef", op: "eq", value }`. Create and update accept it like any other schedule field; existing schedules keep `sourceRef = null`.

<!-- kumiko-changes
feature: ledger
type: improvement
title: Ledger schedules get an optional filterable sourceRef field
detail: |
  `read_ledger_schedules` gets a nullable text column `source_ref` (max 128) plus the non-unique index `(tenant_id, source_ref)`. Callers set it on `createSchedule` / `updateSchedule` to find a schedule again without parsing `description`. Existing schedules keep `sourceRef = null`.
migration: |
  Run `kumiko schema generate`. For a new nullable column and a new non-unique index on a managed projection it emits an in-place `ALTER TABLE "read_ledger_schedules" ADD COLUMN "source_ref" text` plus a `CREATE INDEX`, with no DROP/CREATE and no `.rebuild.json`. No backfill: do not write the column with SQL. Old schedules stay at `sourceRef = null`, so callers should fall back to their previous lookup key for them.
-->
