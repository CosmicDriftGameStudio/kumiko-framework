---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-feature-ast": patch
---

New job trigger `{ maintenance: true }`: one daily run in the app's maintenance window (`KUMIKO_MAINTENANCE_WINDOW`, `HH:MM` UTC, default 03:00), so a sleeping app wakes once a day for all its cleanup jobs. The cleanup jobs of the framework and the bundled features use it.

<!-- kumiko-changes
feature: types
type: improvement
title: JobTrigger gains { maintenance: true }
detail: A job with trigger { maintenance: true } runs once a day at the maintenance window of the app. Prefer it over a fixed cron for housekeeping; the window can be set per app.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Maintenance trigger and KUMIKO_MAINTENANCE_WINDOW
detail: The job runner registers maintenance jobs as a daily UTC scheduler at JobRunnerOptions.maintenanceWindow (default 03:00), set from KUMIKO_MAINTENANCE_WINDOW by runProdApp and runWorkerApp; an invalid value aborts the boot. maintenanceWindowFromEnv is exported from the jobs barrel. files sweep-orphaned-uploads (hourly before) and the soft-delete cleanup jobs (03:00 and 03:15 before) now run in the window. A schedule stored with the old time is replaced on the next start.
-->

<!-- kumiko-changes
feature: jobs
type: improvement
title: Cleanup jobs run once a day in the maintenance window
detail: jobs (stale-run-sweep, hourly before, and retention-cleanup), user-data-rights (export and forget), data-retention, audit escape-hatch-retention, inbound-mail retention, delivery attempt-log-retention and form-draft cleanup use trigger { maintenance: true } instead of 03:00 to 03:30 and hourly crons. Without KUMIKO_MAINTENANCE_WINDOW they all run at 03:00 UTC. A stuck job run is now marked failed at most a day after it crosses the stale timeout.
-->

<!-- kumiko-changes
feature: feature-ast
type: improvement
title: Pattern library documents the maintenance trigger
detail: The job pattern's comment and summary name { maintenance: true }; the parser already reads it as a literal option.
-->
