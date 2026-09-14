---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`JobContext.db` is now a tenant-filtered `TenantDb` bound to the job's resolved tenant (`SYSTEM_TENANT_ID` for tenant-less cron jobs) instead of the unfiltered boot `DbConnection`. Unfiltered access needs a declaration: `r.job({ ..., escapeHatch: { reason } })` grants `ctx.db.unsafeRaw(reason)` for that job, and `r.systemScope()` features keep `ctx.systemDb`. Every grant use reports an `"unsafe-raw"` escape-hatch audit event. `r.job` rejects an `escapeHatch` with an empty reason at registration. Bundled cross-tenant jobs (auth-mfa reencrypt, sessions cleanup, form-draft cleanup, secrets rotate, files-tenant-data sweep, data-retention, inbound-mail retention, tenant-lifecycle destruction, user-data-rights export/forget) now declare `escapeHatch`. The exported `rotateJob` and `sweepOrphanedDerivativesJob` take the raw runner as a third argument.
