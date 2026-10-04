---
"@cosmicdrift/kumiko-server-runtime": patch
---

runWorkerApp records app.started too

The worker now appends the same `kumiko:system:app.started` event as `runProdApp`. The instance id prefers `KUMIKO_INSTANCE_ID` and falls back to `HOSTNAME`, then the OS hostname.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: runWorkerApp records app.started; instance id prefers KUMIKO_INSTANCE_ID over HOSTNAME
-->
