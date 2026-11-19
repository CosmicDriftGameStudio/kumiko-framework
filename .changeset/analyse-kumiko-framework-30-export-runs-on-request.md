---
"@cosmicdrift/kumiko-bundled-features": patch
---

user-data-rights processes a GDPR export right after the request instead of in the next daily maintenance run.

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: GDPR export runs right after the request
detail: The new job `user-data-rights:job:run-requested-export` runs on every committed `request-export` and processes all pending export jobs plus the stale pass. `run-export-jobs` stays in the maintenance window as a backstop. Before, a requested export and a stale running job waited up to a day, and the one-active-export rule blocked a new request in the meantime.
-->
