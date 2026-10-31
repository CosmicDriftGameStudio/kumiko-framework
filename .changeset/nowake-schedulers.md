---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Cron and maintenance jobs can declare that a due run does not wake a sleeping shared app. The tenant destruction sweep uses it.

<!-- kumiko-changes
feature: framework
type: improvement
title: wakesSleepingApp false on cron and maintenance triggers
detail: A job declared with trigger { cron, wakesSleepingApp: false } or { maintenance: true, wakesSleepingApp: false } is scheduled under the BullMQ scheduler id scheduler-nowake-<job> instead of scheduler-<job>, so its delayed jobs are repeat:scheduler-nowake-<job>:<ts> and the waker of sleeping shared apps skips them; the run happens on the next wake. Leaving the flag out keeps waking the app. Any other value, or the flag on an event or manual trigger, stops the registration. On start the runner removes the scheduler the job had under its other id at once, without the orphan grace period, so flipping the flag never leaves the old scheduler firing.
-->

<!-- kumiko-changes
feature: tenant-lifecycle
type: improvement
title: Destruction sweep no longer wakes a sleeping app
detail: The run-tenant-destruction cron declares wakesSleepingApp false, so its per-minute schedule does not keep a sleeping shared app awake. A due destruction runs on the next wake, for example the daily maintenance window. Its scheduler id changes to scheduler-nowake-tenant-lifecycle-job-run-tenant-destruction; the old scheduler is removed on the first start.
-->
