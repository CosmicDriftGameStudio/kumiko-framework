---
"@cosmicdrift/kumiko-bundled-features": patch
---

`forget-subject` for a user records the erase of each owned row's record key in that row's own tenant instead of the caller's.

<!-- kumiko-changes
feature: crypto-shredding
type: fix
title: Owner forget announces record key erases in the row's tenant
detail: `crypto-shredding:write:forget-subject` with `kind: "user"` appends one `subject-forgotten` event per row the user owns through `whenAbsent: "self"` fields. These events went to the caller's tenant, so a data protection officer's tenant received the record keys, and with them the row ids, of rows in other tenants. Each event now goes to the tenant of its row, and the subject-key eraser erases the key as before. The user's own `subject-forgotten` event stays in the caller's tenant.
-->
