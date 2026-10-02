---
"@cosmicdrift/kumiko-bundled-features": patch
---

Retention hardDelete no longer deletes a fileRef that a live row of another entity type still references in a file/image field (relevant for unbound uploads). A storage error while deleting a row's files (for example a missing list permission) now skips only that row with `file_delete_failed` instead of aborting the whole tenant's cleanup run.

<!-- kumiko-changes
feature: data-retention
type: fix
title: Retention hardDelete keeps cross-entity shared files and isolates storage errors per row
-->
