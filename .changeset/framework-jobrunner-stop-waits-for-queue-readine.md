---
"@cosmicdrift/kumiko-framework": patch
---

JobRunner.stop() waits for queue readiness before closing

JobRunner.stop() waits (bounded by the boot Redis timeout) for its queues to be ready before closing them. Stopping a runner right after construction no longer leaves an unhandled "Connection is closed." rejection behind.

<!-- kumiko-changes
feature: framework
type: fix
title: JobRunner.stop() waits for queue readiness before closing
-->
