---
"@cosmicdrift/kumiko-bundled-features": patch
---

Retention hardDelete now shreds the note bodies hanging on the deleted parent row.

<!-- kumiko-changes
feature: data-retention
type: fix
title: Retention hardDelete takes the notes of the deleted parent along
detail: When the retention cleanup hard-deletes a row and notes-history is mounted, the note bodies attached to that row (note-entry, any tenant, including notes written in customer tenants on a global parent) are crypto-shredded in the same sub-transaction as the row's own keys. Before, the parent was gone but its notes stayed readable.
-->
