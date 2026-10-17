---
"@cosmicdrift/kumiko-bundled-features": patch
---

Destroy hooks always process a chunk

<!-- kumiko-changes
feature: files-tenant-data
type: fix
title: Tenant destroy hooks make progress even when the deadline already passed
detail: The chunked migration takes a minBatches option and the file destroy hooks process one chunk per tick, so a slow list call no longer makes every run time out empty.
-->
