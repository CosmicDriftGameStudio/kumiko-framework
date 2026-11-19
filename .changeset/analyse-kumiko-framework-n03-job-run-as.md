---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

`r.job` takes `runAs: { roles }`, and jobs get `ctx.dispatch.query`.

<!-- kumiko-changes
feature: framework
type: improvement
title: Jobs declare the roles they run with
detail: A job's own identity carried only the system role, so a job that had to call a role-gated query or write handler built a SessionUser by hand with `createSystemUser(tenantId, ["SystemAdmin"])` and called `queryAs` or `writeAs` under a `systemIdentity` escape hatch. `r.job({ runAs: { roles: ["TenantAdmin"] } })` gives `ctx.systemUser` these roles next to the system role, and `ctx.dispatch.write` and the new `ctx.dispatch.query` run as that identity. A helper typed on `db`, `registry`, `config`, `obs.log` and `dispatch.query` now works in a handler and in a job without a cast. Boot rejects an empty role list, the system and anonymous roles, and roles no handler declares. `SystemAdmin` can write into other tenants, so it needs `escapeHatch: { reason, grants: ["systemIdentity"] }` on the job or an `r.systemScope()` feature. Events keep the system user as actor.
-->
