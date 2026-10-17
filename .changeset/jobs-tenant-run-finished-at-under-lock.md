---
"@cosmicdrift/kumiko-bundled-features": patch
---

Finished tenant run reads its timestamp under the lock

<!-- kumiko-changes
feature: jobs
type: fix
title: Finished tenant run reads its timestamp under the lock
detail: The run that finishes last in lock order now carries the latest finishedAt, so a stale timestamp can no longer make the newest run the row that gets pruned.
-->
