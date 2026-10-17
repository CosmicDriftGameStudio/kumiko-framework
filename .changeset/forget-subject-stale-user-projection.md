---
"@cosmicdrift/kumiko-bundled-features": patch
---

forget-subject no longer fails with 500 for a user whose stream is deleted but whose status still reads active

<!-- kumiko-changes
feature: crypto-shredding
type: fix
title: forget-subject closes the login door for users whose stream is already deleted
detail: forget-subject returned 500 ("user lifecycle update failed ... not_found") when the user stream was deleted but the read_users status still read active, leaving sessions and PATs alive. The erasure now appends the status-deleted user.updated event to that stream too, so the login door closes, the handler returns 200 and a read_users rebuild keeps the state.
-->
