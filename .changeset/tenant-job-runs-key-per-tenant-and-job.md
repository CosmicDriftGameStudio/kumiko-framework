---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

Tenant job run state is keyed by tenant, job name and BullMQ job id

<!-- kumiko-changes
feature: jobs
type: fix
title: Tenant-visible job runs no longer collide across tenants, jobs and lanes
detail: store_tenant_job_runs was unique on bull_job_id alone, but BullMQ ids count per queue, so a job on the api lane and one on the worker lane (or two tenants after a Redis reset) shared an id and overwrote each other's row. The unique index now covers (tenant_id, job_name, bull_job_id), every write filters by all three, and an enqueue replaces a finished row left over under the same key. onJobDropped now receives { tenantId } as a third argument.
migration: |
  Run `kumiko-schema generate` in your app to add the migration that creates store_tenant_job_runs_tenant_job_bull_job_id_unique and drops store_tenant_job_runs_bull_job_id_unique (generated as a commented DROP INDEX; uncomment it). A custom onJobDropped callback passed to the job runner now gets a third argument { tenantId }.
-->
