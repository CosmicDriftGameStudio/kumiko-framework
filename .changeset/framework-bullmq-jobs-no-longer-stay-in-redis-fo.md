---
"@cosmicdrift/kumiko-framework": patch
---

BullMQ jobs no longer stay in Redis forever: completed jobs are kept 24h, failed jobs 7d (fw#3199)

Both job-runner lane queues now set age-only retention via defaultJobOptions, so dispatch(), handleEvent(), perTenant wrappers and children, cron, runOnBoot and sequential re-enqueues are all covered. BullMQ sweeps retention queue-wide, so there is no count limit and no per-job retention: the cron template's count-based removeOnComplete/removeOnFail is gone because it evicted boot jobs and perTenant children in the same queue. runOnBoot now dedupes via a persistent per-queue marker, so it still runs at most once per Redis dataset after its job hash ages out. On existing datasets a boot job re-runs once only if its job hash was already evicted. A perTenant job whose retry window reaches the completed retention now fails at job-runner construction. Cron iterations scheduled before the deploy keep the old template options for one more run.

<!-- kumiko-changes
feature: framework
type: fix
title: BullMQ jobs no longer stay in Redis forever: completed jobs are kept 24h, failed jobs 7d (fw#3199)
-->
