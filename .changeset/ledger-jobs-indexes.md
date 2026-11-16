---
"@cosmicdrift/kumiko-bundled-features": patch
---

Ledger transactions and job runs gained lookup indexes that apps must ship as a migration.

<!-- kumiko-changes
feature: ledger
type: improvement
title: New indexes on ledger transactions, job runs and job run logs
detail: Added an index on ledger transactions `(tenantId, reference)`, on job runs `(jobName, bullJobId)` and on job run logs `run_id`. Existing databases only get them through a migration; the schema drift check covers tables and columns, not indexes, so boot does not flag them. Apps that mount ledger or jobs run `kumiko schema generate` and ship the resulting migration.
-->
