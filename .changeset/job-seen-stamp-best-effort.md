---
"@cosmicdrift/kumiko-framework": patch
---

A failing scheduler-seen stamp no longer stops the job runner start

<!-- kumiko-changes
feature: framework
type: fix
title: Job runner start survives a failed scheduler-seen stamp
detail: The initial scheduler-seen stamp is best-effort like the periodic refresh and the orphan cleanup: a Redis error is logged as a warning and the runner still starts and registers its cron schedulers.
-->
