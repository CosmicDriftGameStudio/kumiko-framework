---
"@cosmicdrift/kumiko-bundled-features": patch
---

delivery: the `tenantUserIdsQuery` handler of a tenant broadcast now always gets a tenant-filtered `ctx.db` and `ctx.dbOutsideTransaction`, also when it is declared `r.systemScope()`. A systemScope handler could previously read the memberships of every tenant through `ctx.db` and notify users of foreign tenants. Cross-tenant reads stay available through `ctx.systemDb`.

<!-- kumiko-changes
feature: delivery
type: improvement
title: tenant broadcast recipient query no longer reads across tenants through ctx.db
migration: |
  No action needed for handlers that resolve recipients through `ctx.systemDb`, like `tenant:query:resolveUserIds`. A systemScope handler that read `ctx.db` unfiltered now sees only the broadcast tenant's rows.
-->
