---
"@cosmicdrift/kumiko-bundled-features": patch
---

Ledger schedule sourceRef unique index: check for duplicates before upgrading

<!-- kumiko-changes
feature: ledger
type: fix
title: Document the duplicate check required before the (tenant_id, source_ref) unique index
detail: The unique index on read_ledger_schedules (tenant_id, source_ref) is created in place and fails on existing duplicate pairs, and a projection rebuild over duplicate events fails the same way. Replay handling for duplicate events is not part of this change.
migration: |
  Before upgrading, check each database for duplicates and clean them up: SELECT tenant_id, source_ref, count(*) FROM read_ledger_schedules WHERE source_ref IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1; Any row returned makes the unique index migration abort.
-->
