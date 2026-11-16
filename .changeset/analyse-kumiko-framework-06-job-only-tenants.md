---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

`r.job` takes `onlyTenants` to run a perTenant job only for the listed tenants.

<!-- kumiko-changes
feature: jobs
type: improvement
title: perTenant jobs can be narrowed to listed tenants with onlyTenants
detail: A perTenant cron that only serves one tenant used to fan out one child job per active tenant, and every child except one returned at once from a guard in the handler. `onlyTenants: [tenantId, ...]` on `r.job` keeps the fan-out to the listed tenants that are also active, so a deactivated tenant still gets no run. Boot rejects `onlyTenants` without `perTenant`, on an event trigger, as an empty list, together with `includeSystemTenant`, with an entry that is not a tenant id, or with the system tenant (a job without perTenant already runs for it).
-->
