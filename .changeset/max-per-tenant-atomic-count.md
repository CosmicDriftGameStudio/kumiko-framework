---
"@cosmicdrift/kumiko-framework": patch
---

`maxPerTenant` counts active and waiting jobs in one snapshot per queue.

<!-- kumiko-changes
feature: framework
type: fix
title: maxPerTenant counts active and waiting jobs in one snapshot
detail: The guard read the active and the waiting list with separate Redis calls, so a job that moved from waiting to active between them was missing from both and a dispatch over the cap got through. It now reads both lists with one getJobs snapshot per queue. The integration tests hold the cap jobs on a release gate instead of sleeping.
-->
