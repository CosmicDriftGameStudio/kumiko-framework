---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-types": patch
---

The step-dispatcher sweep no longer closes dispatches whose deliver job is still alive.

<!-- kumiko-changes
feature: step-dispatcher
type: fix
title: Abandoned-dispatch sweep skips live deliver jobs and cannot overwrite a concurrent outcome
detail: Before closing a request older than 24 h the sweep asks the job runner whether its deliver job is still waiting, delayed, active, paused or prioritized and skips it until a later run. A runner that cannot report job state makes the sweep skip everything and warn. The failure event is appended with the stream version that was loaded, so a delivery recording its outcome in between causes a version conflict (reported through the close-failure log) and the payload key is not erased. `JobRunner` and `JobRunnerRef` gain an optional `isJobPending(jobName, jobId)`, and `MultiStreamApplyContext.unsafeAppendEvent` accepts an optional `expectedVersion`.
-->
