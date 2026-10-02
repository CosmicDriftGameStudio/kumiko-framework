---
"@cosmicdrift/kumiko-bundled-features": patch
---

The export storage-cleanup pass now also reports an `export_cleanup_last_run_timestamp` gauge (Unix seconds, set only when a pass completes) so a stalled cron can be alerted on with `time() - metric > interval + buffer`; the backlog gauge keeps its last value when the cron stops, so `absent()` never fires. The backlog gauge is now reported even when the pass throws. The workflow-runner event wakeup uses the framework `getTemporal()` instead of the global `Temporal`, and a redelivered `workflow.waiting-for-event` no longer resets an already matched trigger.

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: Export cleanup reports a last-run timestamp gauge and still reports backlog age when the pass throws
-->
