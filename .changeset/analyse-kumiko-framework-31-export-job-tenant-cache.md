---
"@cosmicdrift/kumiko-bundled-features": patch
---

The export job resolves each tenant's compliance profile and storage provider once per run instead of once per job.

<!-- kumiko-changes
feature: user-data-rights
type: improvement
title: Export job looks up each tenant once per run
detail: `runExportJobs` resolved the tenant's compliance profile again for every running, pending and expired job, and built the storage provider again for every pending job and every cleanup candidate. A run now caches both per tenant, so a backlog of many jobs from one tenant costs one profile lookup and one provider build. A failed provider build is not cached, so the next candidate tries again.
-->
