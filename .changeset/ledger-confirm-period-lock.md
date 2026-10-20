---
"@cosmicdrift/kumiko-bundled-features": patch
---

ledger confirm-schedule-period takes its lock through TenantDb

<!-- kumiko-changes
feature: ledger
type: improvement
title: ledger confirm-schedule-period takes its lock through TenantDb
detail: confirm-schedule-period serializes parallel confirms of one schedule period with ctx.db.advisoryXactLock instead of an unsafeRaw connection and an escapeHatch declaration. The lock key is unchanged (tenant id plus reference), so nothing changes for running installations.
migration: None.
-->
