---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

The projection-rebuild job also rebuilds multi-stream projections

`enqueueProjectionRebuild` and the `jobs:job:projection-rebuild` worker used to call the single-stream rebuild only, so a multi-stream projection name failed with "not registered". Both now go through `rebuildProjectionOrMultiStream` (exported from `@cosmicdrift/kumiko-framework/migrations`), the same helper the pending-rebuild queue uses. For multi-stream projections the skip mode comes from the projection's declared `errorMode`; the job payload's `skipApplyErrors` only applies to single-stream projections.

<!-- kumiko-changes
feature: framework
type: fix
title: The projection-rebuild job also rebuilds multi-stream projections
-->
