---
"@cosmicdrift/kumiko-server-runtime": patch
---

`billing.webhookPath` sets the webhook route for every provider, so a Paddle-only setup can move it too; `billing.stripe.webhookPath` is deprecated and still read as a fallback. The worker uses the same env-default and boot-validation steps as the API process, and a failing worker entrypoint build closes the Redis SSE broker it opened.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: provider-wide billing webhookPath, shared worker boot steps, no leaked SSE broker
detail: `billing.webhookPath` replaces `billing.stripe.webhookPath` (deprecated, still read as a fallback) and the error message names the new key. `runWorkerApp` applies env defaults through `withEnvDefaults` and `bootWorkerProcess` validates through the shared `validateBootAndWarnTz` step. If `createWorkerEntrypoint` throws, the Redis SSE broker opened before it is closed instead of keeping the process alive. The stream tenant backfill decides searchability with the shared `isEntitySearchable`.
-->
