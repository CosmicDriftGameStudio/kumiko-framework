---
"@cosmicdrift/kumiko-framework": patch
---

Expired fileRef purge no longer stalls on rows that keep failing

<!-- kumiko-changes
feature: framework
type: fix
title: Expired fileRef purge no longer stalls on rows that keep failing
detail: The soft-delete cleanup always selected the oldest 500 expired fileRefs, so 500 permanently failing rows (unsafe key, missing list permission) blocked every newer expired fileRef of that tenant. A run now walks the expired rows page by page along (deletedAt, id) and ends on an empty page; failed rows are retried on the next run.
-->
