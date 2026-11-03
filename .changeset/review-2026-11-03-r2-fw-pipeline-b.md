---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Pipeline, migration and job-runner review fixes from the second review round.

<!-- kumiko-changes
feature: framework
type: fix
title: pipeline, event-payload-scrub and job-runner review fixes
detail: Projection rebuild only names the boot backfill as the expected column-drift cause when the sample covers every drifted row and is not empty. A batch consumer at the pending-gap limit no longer burns attempts on passes where all held events only wait out a backoff (`holdForRetry` takes an optional `{ stillBackingOff }`), and `lastError` carries the reason of the event `lastFailedEventId` points at. `scrubEventPayloadFields` logs real runs at info with migration id, reason and totals and documents that it belongs in a maintenance window. Job runner: the perTenant fan-out and the unknown-job path count attempts like every other pre-run path (`_priorAttempts`, `retryable`), a throwing `onJobFailed` hook no longer replaces the original pre-run error, `parseRedisOpts` strips IPv6 brackets and tolerates a credential with a stray percent sign, and one `isQueuedRun` predicate backs `ctx.defer`, `ctx.canDefer` and both defer paths. Tests added for the rate-limit cost floor and rounding, the scrub pagination, snapshot, non-lifecycle, corrupt-ciphertext and failed-rebuild paths.
-->
