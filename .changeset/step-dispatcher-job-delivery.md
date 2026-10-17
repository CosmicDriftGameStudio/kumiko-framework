---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

step-dispatcher delivers through a BullMQ job

<!-- kumiko-changes
feature: step-dispatcher
type: fix
title: step-dispatcher delivers each dispatch as a retried job, so a slow receiver no longer delays other tenants
detail: The step-dispatcher projection now only enqueues one `step-dispatcher:job:deliver` job per dispatch request, and the job performs the webhook or mail delivery. Redis holds only the dispatch stream id and the tenant, never the request payload. Transient failures (network error, timeout, 5xx, 408, 429, any mail adapter failure) are retried 3 times with exponential backoff; the outcome event and the payload key erase follow after the final attempt. Permanent failures (invalid url, blocked host, other 4xx, unavailable auth secret) are recorded at once. At most 2 deliveries per tenant run at the same time, so one tenant's slow receivers cannot hold up the others. This corrects the 0.346.0 note that a hanging receiver no longer stalls the dispatcher for every tenant: the shared consumer still delivered one request at a time.
migration: step-dispatcher now needs a job runner (Redis) and a worker consuming the default worker lane. Without a job runner the projection throws instead of delivering. Test stacks must pass `jobs` to setupTestStack and call `drainJobs()` after the event dispatcher ran. `r.job` accepts `maxPerTenant: { limit, onLimit: "defer", deferMs? }`; a plain number still drops excess enqueues. A `webhook.send` request that gets a retryable status (5xx, 408, 429) is now sent up to 4 times under the same Idempotency-Key. Worker pods must know the deliver job before the projection enqueues it, so deploy worker and API together or the worker first. A dev server only consumes jobs when the app mounts `createJobsFeature()`.
-->
