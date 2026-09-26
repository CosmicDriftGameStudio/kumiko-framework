---
"@cosmicdrift/kumiko-framework": minor
---

runInOwnTransaction(tenantDb, fn) runs fn in a fresh transaction on a TenantDb's pool runner

Exported from @cosmicdrift/kumiko-framework/db. fn receives a TenantDb with the same tenant, mode and grants bound to the new transaction. Fails closed for a TenantDb not built by createTenantDb, a memberReadOnly TenantDb, and a runner that is already inside a transaction.

<!-- kumiko-changes
feature: framework
type: improvement
title: runInOwnTransaction(tenantDb, fn) runs fn in a fresh transaction on a TenantDb's pool runner
-->
