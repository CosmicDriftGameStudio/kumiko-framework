---
"@cosmicdrift/kumiko-bundled-features": minor
---

files-tenant-data drops the manual job that swept derivatives orphaned before forget and tenant destroy deleted binaries.

<!-- kumiko-changes
feature: files-tenant-data
type: breaking
title: The orphaned-derivative sweep job is removed
detail: `files-tenant-data:job:sweep-orphaned-derivatives` cleaned up derivatives left behind by forget or tenant-destroy runs from before those flows deleted binaries. Both flows now delete an original together with its derivatives, so the job had nothing left to find and is gone together with its cross-tenant `escapeHatch`. `sweepOrphanedDerivativesJob` and `sweepOrphanedDerivativesPayloadSchema` are no longer exported. The tenant-destroy hooks are unchanged.
migration: Remove calls to `sweepOrphanedDerivativesJob` and triggers of `files-tenant-data:job:sweep-orphaned-derivatives`. If a storage bucket still holds derivatives orphaned before forget and tenant destroy deleted binaries, delete them by hand.
-->
