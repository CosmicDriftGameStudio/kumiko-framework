---
"@cosmicdrift/kumiko-framework": patch
---

The sequential-job lock is released when `prepareJobRun` or `onJobStart` throws, so later runs of the same job no longer wait for the lock TTL. Such run-start failures now also reach the process log ("job failed") and `onJobFailed`. The seed-migration `systemWriteAs` error message no longer repeats the `es-ops/seed-migration` namespace that the runner logger already prints. The maxDefers integration test waits for the final job state instead of sleeping.

<!-- kumiko-changes
feature: framework
type: fix
title: Sequential job lock released when run setup fails
detail: handleJob() claimed the sequential lock before prepareJobRun() and the onJobStart hook, but only released it in the finally block that started after them. A throwing onJobStart left the lock until its TTL (305 s) and every further invocation of that job was requeued behind it. Both calls now run inside the try and the lock is released by job name. A failure there is logged and, on the final attempt, reported through onJobFailed. The seed-migration failure message starts with systemWriteAs(...) instead of the duplicated [es-ops/seed-migration] prefix.
-->
