---
"@cosmicdrift/kumiko-framework": patch
---

Soft-delete cleanup no longer aborts on `tenancy: "global"` tables

`soft-delete:job:cleanup` aborted for a tenant as soon as an entity with `tenancy: "global"` and a `tenantId` column (such as `user`) had softDelete enabled, so the tenant's other entities were not cleaned either. Both cleanup jobs now decide by the entity's tenancy declaration. The per-tenant job skips global tables; `soft-delete:job:cleanup-system` hard-deletes their expired rows once, system-wide, through `db.global()`. Jobs can now receive the `globalWrites` grant from their `escapeHatch` declaration.

The first run of `soft-delete:job:cleanup-system` after the update hard-deletes soft-deleted users older than the fixed 30-day grace period in every app with the user feature. Earlier versions never removed them.

<!-- kumiko-changes
feature: framework
type: fix
title: Soft-delete cleanup works for global tables such as user
migration: |
  None required. The first nightly run of `soft-delete:job:cleanup-system` after the bump hard-deletes soft-deleted users older than 30 days; restore any you still need before it runs.
-->
