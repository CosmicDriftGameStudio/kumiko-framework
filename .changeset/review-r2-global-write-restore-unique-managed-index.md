---
"@cosmicdrift/kumiko-framework": patch
---

Tenant-mode `updateMany`/`deleteMany` on a `tenancy: "global"` table now reject with an `AccessDeniedError` pointing at `db.global(table)` instead of silently matching zero rows. `restore` on a soft-deleted row whose unique value was re-used now returns a 409 `unique_violation` instead of a raw 500. The migration generator now recreates a managed projection when an existing index becomes unique, changes columns or widens its WHERE.

<!-- kumiko-changes
feature: framework
type: breaking
title: Global-table tenant writes reject loudly, restore maps unique violations, managed unique-index changes recreate
migration: |
  Tenant-mode `updateMany`/`deleteMany` on a `tenancy: "global"` table now throws instead of matching zero rows; switch those calls to `db.global(table)`.
-->
