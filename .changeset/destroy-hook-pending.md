---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Tenant destroy hooks can report that they wait on a running external operation. Such ticks do not count as failed attempts, but the wait is limited per attempt.

<!-- kumiko-changes
feature: framework
type: improvement
title: pending flag on TenantDestroyHookResult
detail: A destroy hook may return { done: false, processed: 0, pending: true } when it waits on an external operation it has already started, for example a remote teardown job. The field is optional, so existing hooks keep compiling and keep their behavior.
-->

<!-- kumiko-changes
feature: tenant-lifecycle
type: improvement
title: Destroy stages can wait on external operations
detail: A tick in which a hook reports pending is recorded as a progressed event with pending true and does not count as a failed attempt. The wait is bounded: once 60 minutes (DESTRUCTION_STAGE_MAX_PENDING_MS) have passed since the attempt's stage-started event, a pending tick fails the attempt with "still pending", and the stage is abandoned after its usual maxAttempts, so a stage waits at most maxAttempts x 60 minutes. Ticks without progress and without pending still count as failed attempts. stage-started events now carry startedAt from the sweep clock.
-->
