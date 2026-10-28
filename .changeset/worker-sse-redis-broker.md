---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

A dedicated worker publishes its live signals over Redis to the SSE clients of the API process.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Worker SSE signals reach the API clients when the env comes from envSource
detail: The worker built its SSE broker from process.env only. A worker started with `runWorkerApp({ envSource })` and no REDIS_URL in process.env kept an in-memory broker, so signals from jobs and consumers never reached the SSE clients connected to the API process. The worker boot now builds the broker from the same env source as the API and closes it on shutdown. `WorkerEntrypointOptions` gets an optional `sseBroker`.
-->
