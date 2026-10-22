---
"@cosmicdrift/kumiko-framework": patch
---

The job runner's per-run path is split into named steps for the pre-run gates, the run context, the handler span and the deferral. Gate order, log lines, callbacks and Redis writes are unchanged.

<!-- kumiko-changes
feature: framework
type: improvement
title: Job runner run path split into named steps
detail: handleJob() in jobs/job-runner.ts now composes the perTenant fan-out, the unknown-job check, the maxPerTenant defer gate and the sequential lock (job-runner-gates.ts), the run context with its db, service and dispatch facets (job-runner-context.ts), the job.execute span with success and failure recording (job-runner-execution.ts) and the handler deferral. The runner's shared state travels in one scope object (job-runner-scope.ts). The jobs barrel exports the same names as before. New integration tests cover unknown jobs taken from the queue, a perTenant wrapper for an unknown job, a perTenant job without a tenant resolver and ctx.defer with a non-positive delay.
-->
