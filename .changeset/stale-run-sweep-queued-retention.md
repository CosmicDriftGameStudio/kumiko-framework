---
"@cosmicdrift/kumiko-bundled-features": patch
---

Stale-run sweep keeps queued runs for the retention window

<!-- kumiko-changes
feature: jobs
type: fix
title: Stale-run sweep uses the job-run retention window for queued runs
detail: The sweep now only fails queued runs that are older than the configured retention days instead of every queued run past the stale cutoff, so freshly queued runs of a long backlog are no longer failed.
-->
