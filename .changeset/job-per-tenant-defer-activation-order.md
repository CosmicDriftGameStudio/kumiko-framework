---
"@cosmicdrift/kumiko-framework": patch
---

`maxPerTenant` with `onLimit: "defer"` no longer lets two jobs of one tenant run past the limit when they become active at the same moment.

<!-- kumiko-changes
feature: framework
type: fix
title: maxPerTenant defer holds the limit for jobs activated together
detail: The defer check ordered active jobs by the worker timestamp at pickup. Two jobs of one tenant picked up in the same millisecond, or by workers whose clocks differ, could both see the other as started later and both run, so a limit of 1 ran two jobs at once. The check now uses the order in which BullMQ moved the jobs to active: a job counts only the jobs activated before it, so at most `limit` run and the earliest one of a burst always starts.
-->
