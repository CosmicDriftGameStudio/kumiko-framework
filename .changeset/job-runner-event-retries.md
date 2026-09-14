---
"@cosmicdrift/kumiko-framework": patch
---

Fix: an event-triggered job (`r.job({ trigger: { on: [...] } })`) now retries on failure the same way a directly-dispatched job does. `JobRunner.handleEvent` previously enqueued the BullMQ job with no options at all, dropping the job definition's `retries`/`backoff` — a failing event-triggered job never got a second attempt, unlike the same job dispatched via `dispatch()`. Both paths now build their BullMQ retry options through one shared `buildRetryBullOpts(jobDef)` helper.
