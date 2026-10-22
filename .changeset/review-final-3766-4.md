---
"@cosmicdrift/kumiko-framework": patch
---

A boot gate that runs into its timeout now settles (bounded) before `start()` rejects, so the abandoned gate handler cannot keep writing to the database and Redis while the process shuts down, even if the caller never invokes `stop()`.

<!-- kumiko-changes
feature: framework
type: fix
title: Failed job-runner start waits for the timed-out boot gate
detail: start() now waits a bounded time for an abandoned boot gate before throwing, instead of leaving that to stop(). The scheduler-seen timer is only started after every step that can fail, so no timer outlives a failed start.
-->
