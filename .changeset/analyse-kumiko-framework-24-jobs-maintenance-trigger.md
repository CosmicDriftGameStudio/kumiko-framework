---
"@cosmicdrift/kumiko-bundled-features": patch
---

A SystemAdmin can now start maintenance jobs by hand from the job-runs screen.

<!-- kumiko-changes
feature: jobs
type: fix
title: Maintenance jobs can be started by hand
detail: `jobs:write:trigger` and `jobs:query:catalog` accepted only jobs with `trigger: { manual: true }`, so a job moved to `trigger: { maintenance: true }` (for example `sessions:job:cleanup`) could no longer be started from the job-runs screen and failed with `job_not_manual`. Both handlers now also accept maintenance jobs. Every bundled maintenance job checks its own retention or grace period, so an early run removes only rows that are already due. Cron and event jobs stay rejected, and both handlers stay SystemAdmin-only.
-->
