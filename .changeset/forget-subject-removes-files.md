---
"@cosmicdrift/kumiko-bundled-features": patch
---

forget-subject removes files bound to the forgotten subject

<!-- kumiko-changes
feature: crypto-shredding
type: fix
title: forget-subject removes files bound to the forgotten subject
detail: Forgetting a record or user subject now deletes the bytes, derivatives and file_refs rows behind that subject's personal file fields (fail closed with missing_file_storage or file_delete_failed in cleanupError), so a retry can finish the job; the entity row stays.
-->
