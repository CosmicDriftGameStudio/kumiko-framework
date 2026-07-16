---
"@cosmicdrift/kumiko-framework": patch
---

Fix `kumiko_job_queue_depth` never emitting any data (only the metric's HELP/TYPE header) under `createApiEntrypoint`/`createWorkerEntrypoint`/`createAllInOneEntrypoint`. The job-runner was built from the caller's raw `context` *before* `buildServer` merged the resolved observability provider's `tracer`/`meter` into its own internal context — so `context.meter` stayed `undefined` on the job-runner side, and the queue-depth poller's `if (context.meter)` guard silently skipped starting at all (unlike the tracer, which has its own fallback). The observability provider is now resolved once per entrypoint boot and threaded into both the job-runner's context and `buildServer`, so both sides observe the same meter instance.
