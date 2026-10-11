---
"@cosmicdrift/kumiko-framework": patch
---

Job runner removes job schedulers of cron jobs that no longer exist

When an app drops a cron job, its BullMQ job scheduler stayed in Redis and kept firing, so the worker logged `Unknown job` on every tick. On start, each lane now removes every scheduler in its own queue that does not belong to a registered cron job of that lane (logged per removal). Each runner records when it last upserted a scheduler; a scheduler outside the runner's own set is only removed if it was not upserted within the last hour, so an old pod restarting during a rolling deploy does not delete the scheduler of a cron job the new version just added. Schedulers with no record, such as the old colon-form ids, are removed right away. A failing cleanup is logged as a warning and does not stop the start. This replaces the dedicated removal of the old colon-form scheduler ids.

<!-- kumiko-changes
feature: framework
type: fix
title: Job runner removes job schedulers of cron jobs that no longer exist
-->
