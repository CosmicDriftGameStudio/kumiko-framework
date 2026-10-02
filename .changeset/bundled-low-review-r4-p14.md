---
"@cosmicdrift/kumiko-bundled-features": patch
---

The delivery log query no longer skips rows at a page boundary when the sort column has duplicate values. A toggle flip received while the initial snapshot loads is no longer overwritten by the older DB read. The stale job-run sweep encrypts and updates once per triggering user instead of once per run.

<!-- kumiko-changes
feature: delivery
type: fix
title: Delivery log paging no longer skips rows tied on the sort value
-->

<!-- kumiko-changes
feature: feature-toggles
type: fix
title: A toggle flip signalled during the initial load survives the snapshot read
-->

<!-- kumiko-changes
feature: jobs
type: improvement
title: Stale job-run sweep batches its writes per triggering user
-->
