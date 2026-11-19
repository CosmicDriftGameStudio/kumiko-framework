---
"@cosmicdrift/kumiko-bundled-features": patch
---

Retention hardDelete and subject erasure now rebind a file that another row still holds to that holder instead of leaving it bound to the purged row, so owner-row read gates keep the holder's file readable.

<!-- kumiko-changes
feature: files
type: fix
title: Shared files survive the purge of their bound row
detail: When a hardDelete purge skips a file shared with another row, the file is rebound to the first remaining holder (by id). Before, it stayed bound to the deleted row and a read gate on the owner row hid it from every reader, for example a signed PDF filed as a document.
affects: data-retention, files, purgeRowFileRefs
-->
