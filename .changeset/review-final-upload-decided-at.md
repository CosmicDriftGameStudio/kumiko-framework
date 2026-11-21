---
"@cosmicdrift/kumiko-bundled-features": patch
---

A connector upload stamps its quota decision time before the quota check, so a slowly accepted upload no longer clears the storage-full flag set by a later refused one.

<!-- kumiko-changes
feature: connectors
type: fix
title: storage-full flag survives a slow earlier upload
detail: The device touch of an upload now carries the instant taken before the upload was dispatched. An early upload that is accepted late cannot clear the refusal of an upload that began after it.
-->
