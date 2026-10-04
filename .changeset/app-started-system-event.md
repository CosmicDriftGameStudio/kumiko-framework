---
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-framework": minor
---

runProdApp records a `kumiko:system:app.started` event on every boot

Each start appends one event under the system tenant (stream type `app-instance`) with the app version, the instance id (`HOSTNAME`, else the OS hostname) and the start time. Set `KUMIKO_APP_VERSION` and optionally `KUMIKO_GIT_COMMIT` in the deployment; without a version the event records `"unknown"`. A failed write is logged and does not stop the boot. The framework exports `APP_STARTED_EVENT_TYPE` and `APP_INSTANCE_STREAM_TYPE` from `event-store`.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: runProdApp records an app.started system event with version and instance on every boot
-->
