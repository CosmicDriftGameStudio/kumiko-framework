---
"@cosmicdrift/kumiko-types": minor
---

TenantDb gains databaseNow().

<!-- kumiko-changes
feature: framework
type: breaking
title: TenantDb.databaseNow
detail: TenantDb has a databaseNow() method returning Postgres now(); custom TenantDb implementations must add it.
migration: Add databaseNow(): Promise<Date> to hand-built TenantDb objects and mocks, returning the Postgres now().
-->
