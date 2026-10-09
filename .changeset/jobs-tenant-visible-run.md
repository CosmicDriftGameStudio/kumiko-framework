---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Tenant-visible job run state: `r.job({ tenantVisibleRun })` plus `jobs:query:tenant-runs`

A tenant can read whether work for a subject is queued or running, with its times, and the last completed or failed run. Counterpart to `tenantVisibleFailure`, without payloads, error texts or logs.

- `JobDefinition.tenantVisibleRun: { subjectFields? }`: opt in per job. `subjectFields` name primitive payload fields that scope the state (stored in clear, never a PII field). A non-primitive value fails the run, as for `tenantVisibleFailure`.
- New table `store_tenant_job_runs`: run `kumiko-schema generate <name>` in your app and apply the migration (`kumiko-schema apply`). It stays empty until a job opts in.
- `jobs:query:tenant-runs` (payload `{ jobName?, subject?, limit? }`, every membership rank, own tenant only) returns `{ rows: [{ jobName, subject, status, queuedAt, startedAt, finishedAt }], nextCursor: null }`: all queued and running runs plus the latest completed or failed one per job and subject, active runs first.
- A failed attempt that BullMQ retries shows as `queued` again; only the final failure shows `failed`. The stale-run sweep fails `running` rows and drops `queued` rows older than `staleRunTimeoutHours`; `retention-cleanup` purges finished rows older than `retentionDays`.
- `JobRunnerOptions` gains optional `onJobQueued(jobName, jobId, { tenantId, subject })` and `onJobDropped(jobName, jobId)`; `JobMeta.tenantVisibleRun` and `JobOutcomeMeta.tenantVisibleRun` carry the subject to `onJobStart`/`onJobComplete`/`onJobFailed`. `jobRunLoggerCallbacks` and the test stack wire them automatically; existing callbacks keep working.

<!-- kumiko-changes
feature: jobs
type: improvement
title: Tenant-visible job run state: r.job({ tenantVisibleRun }) plus jobs:query:tenant-runs
detail: A job that declares `tenantVisibleRun` keeps its queued, running, completed and failed state per tenant and subject in the new table `store_tenant_job_runs`, and the tenant reads it through `jobs:query:tenant-runs` (payload `{ jobName?, subject?, limit? }`, own tenant only). Each row is `{ jobName, subject, status, queuedAt, startedAt, finishedAt }`: every queued or running run plus the latest completed or failed one per job and subject, active runs first. No payload, error text or log ever reaches the tenant. A failed attempt that is retried shows as `queued` again. The stale-run sweep and `retention-cleanup` also cover the new table. `JobRunnerOptions` gains `onJobQueued` and `onJobDropped`.
migration: New store table. Run `kumiko-schema generate <name>` and apply the migration with `kumiko-schema apply` - `store_tenant_job_runs` is created empty and stays empty until a job declares `tenantVisibleRun`. No change needed for apps that do not opt in.
-->
