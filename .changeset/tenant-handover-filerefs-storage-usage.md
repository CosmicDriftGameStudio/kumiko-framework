---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

tenant-handover claim now moves a fileRef's own event history and storage-usage counters

<!-- kumiko-changes
feature: tenant-handover
type: fix
title: tenant-handover claim now moves a fileRef's own event history and storage-usage counters
detail: |
  moveFileRefs only flipped the file_refs read-model row's tenant_id: the
  fileRef aggregate's own events in kumiko_events stayed under the source
  tenant, so a later write against the moved fileRef couldn't load its
  stream, and a projection rebuild put the row back into the source
  tenant. It also never touched the fileRef's share of the
  tenant-storage-usage MSP counters, leaving stale bytes/fileCount behind
  under the source tenant and none under the destination. moveFileRefs now
  also calls moveEventHistory for the fileRef aggregate and a new
  transferTenantStorageUsage (framework, exported via the files barrel),
  which locks the MSP's consumer cursor row, sums the already-applied
  fileRef deltas via the newly extracted fileRefStorageDelta, and moves
  them from source to destination before the tenant_id rewrite runs (the
  "already applied" lookup keys off the pre-rewrite tenant_id). No
  migration needed.
-->
