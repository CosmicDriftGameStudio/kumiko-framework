---
"@cosmicdrift/kumiko-framework": patch
---

`maxPerTenant` with `onLimit: "defer"` no longer lets two jobs of one tenant run past the limit when they become active at the same moment.

<!-- kumiko-changes
feature: framework
type: fix
title: maxPerTenant defer holds the limit for jobs activated together
detail: The defer check ordered active jobs by the worker timestamp at pickup. When a second job of the same tenant was picked up in the same millisecond, or by a worker whose clock ran behind, it took the already running job for a later one, did not count it and ran as well, so a limit of 1 ran two jobs at once. The check now uses the order in which BullMQ moved the jobs to active: a job counts only the jobs activated before it, so at most `limit` run at a time. An active job with the same name in the other lane queue always counts, so in rare cases a job waits one more defer delay than needed.
-->
