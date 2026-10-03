---
"@cosmicdrift/kumiko-bundled-features": patch
---

Bundled features read and write through the typed bun-db helpers instead of hand-written SQL. Behaviour stays the same.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Payment and subscription projections use typed bun-db helpers
detail: |
  `payment-received` inserts through `insertOnConflictDoNothing`, subscription events upsert through `upsertOnConflict`. The raw `db/queries/payment-projection.ts` and `subscription-projection.ts` modules are gone.
migration: |
  keine
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Inbound mail projections use typed bun-db helpers
detail: |
  Mail-account and mail-thread events upsert through `upsertOnConflict` (`connectedAt` is only written on insert), inbound messages insert through `insertOnConflictDoNothing`. The raw `db/queries/inbound-projections.ts` module is gone.
migration: |
  keine
-->

<!-- kumiko-changes
feature: workflow-runner
type: improvement
title: The resume job reads due runs through the job's TenantDb
detail: |
  `selectDueWorkflowRunPending` takes a `TenantDb` and returns `{ runId, stepIndex }` rows, so the tenant filter comes from the TenantDb instead of a hand-written `WHERE tenant_id`.
migration: |
  keine
-->

<!-- kumiko-changes
feature: user
type: improvement
title: The last-SystemAdmin check uses jsonb containment through selectMany
detail: |
  Removing the SystemAdmin role still refuses to drop the last active SystemAdmin; the count now comes from `selectMany` with a roles containment filter instead of raw SQL.
migration: |
  keine
-->
