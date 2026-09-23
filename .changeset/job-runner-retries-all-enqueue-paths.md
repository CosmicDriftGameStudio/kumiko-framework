---
"@cosmicdrift/kumiko-framework": patch
---

Fix: cron-scheduled jobs, `runOnBoot` jobs, the `perTenant` fan-out wrapper and its fanned-out children, and the sequential concurrency re-enqueue path now all pass through a job definition's `retries`/`backoff` when enqueuing into BullMQ. Previously only `dispatch()` and `handleEvent()` built these options via `buildRetryBullOpts(jobDef)` — a job with `retries` set that was reached through any of the other paths still failed for good on its very first error. All enqueue paths now share the same helper.
