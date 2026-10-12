---
"@cosmicdrift/kumiko-bundled-features": patch
---

A finished tenant job run replaces the older finished run of the same subject in one transaction, so the run store never holds two finished rows for one subject.

<!-- kumiko-changes
feature: jobs
type: fix
title: Finished tenant job run replaces the older one atomically
detail: recordTenantRunOutcome wrote the new completed or failed row and pruned older finished rows of the same tenant, job and subject in two separate statements, so the store briefly held two finished rows per subject, and two runs of one subject finishing together could each miss the other's row and leave both. Both writes now run in one transaction under a per-key advisory lock (namespace tjrl). jobs:query:tenant-runs already showed only the newest finished row, so its result does not change.
-->
