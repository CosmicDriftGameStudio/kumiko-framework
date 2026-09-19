---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Tenant-visible job failures: `r.job({ tenantVisibleFailure })` plus `jobs:query:failures` (fw#3079)

A fire-and-forget job that fails left the tenant's screen on a spinner that never ends — `jobs:query:list` is SystemAdmin and reads cross-tenant over `systemDb.unsafeRaw`, so a tenant could not see its own job failing. Apps worked around it with their own failure entity written in the job's catch.

A job now opts in declaratively: `r.job("generateTexts", { trigger: …, tenantVisibleFailure: { messageKey: "app:errors.generationFailed", subjectFields: ["campaignId"] } }, handler)`. When its last attempt fails, the run-logger records one row per tenant, job and subject in the new `store_tenant_job_failures` table, and the tenant reads it back through `jobs:query:failures` (every membership rank, own tenant only).

Only a translation key travels to the tenant: the thrown error's own `i18nKey` when it carries one, otherwise the declared `messageKey`. The provider's message stays on `store_job_runs.error` and in the run log, both SystemAdmin-only. Records are scoped to the run's tenant — a tenant-less run (cron, `SYSTEM_TENANT_ID`) records nothing.

Lifetime and retries: a record lives until the next successful run of the same job and subject deletes it; there is no acknowledgement step (tenant job administration stays out of scope). Only the final attempt records, so a job with `retries` that succeeds on a later attempt never shows the tenant a failure. The daily `retention-cleanup` job purges leftovers past `retentionDays`.

`jobs:query:list`, `jobs:query:details` and `jobs:query:retry` are unchanged. `JobRunnerOptions.onJobComplete`/`onJobFailed` gained an optional fifth `outcome` argument — existing four-argument callbacks keep working.

<!-- kumiko-changes
feature: jobs
type: improvement
title: Tenant-visible job failures: `r.job({ tenantVisibleFailure })` plus `jobs:query:failures` (fw#3079)
migration: New store table. Run `kumiko migrate generate` and apply the migration — `store_tenant_job_failures` is created empty and stays empty until a job declares `tenantVisibleFailure`. No change needed for apps that do not opt in.
-->
