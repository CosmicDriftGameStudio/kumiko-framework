---
"@cosmicdrift/kumiko-bundled-features": minor
---

Schedule sourceRef is unique per tenant (partial unique index read_ledger_schedules_tenant_id_source_ref_uidx)

<!-- kumiko-changes
feature: ledger
type: breaking
title: Schedule sourceRef is unique per tenant (partial unique index read_ledger_schedules_tenant_id_source_ref_uidx)
migration: |
  sourceRef is now unique per tenant: a second createSchedule (or updateSchedule) with a sourceRef already used in the same tenant fails with unique_violation (HTTP 409). Schedules without a sourceRef and the same sourceRef in different tenants stay allowed. Before applying, check for duplicates: SELECT tenant_id, source_ref, count(*) FROM read_ledger_schedules WHERE source_ref IS NOT NULL GROUP BY tenant_id, source_ref HAVING count(*) > 1; and resolve them through real writes (updateSchedule with another sourceRef). kumiko schema generate treats the new unique index on a managed projection as destructive (DROP TABLE + CREATE TABLE + .rebuild.json); a rebuild would also hit the unique index on historical duplicates. Hand-edit the generated migration: replace the generated DROP/CREATE with exactly DROP INDEX IF EXISTS "read_ledger_schedules_tenant_id_source_ref_idx"; CREATE UNIQUE INDEX IF NOT EXISTS "read_ledger_schedules_tenant_id_source_ref_uidx" ON "read_ledger_schedules" ("tenant_id", "source_ref") WHERE "source_ref" IS NOT NULL; and discard the generated .rebuild.json (delete the file, do not commit it). Code that does find-then-create by sourceRef should expect unique_violation on create and re-read the schedule that won the race.
-->
