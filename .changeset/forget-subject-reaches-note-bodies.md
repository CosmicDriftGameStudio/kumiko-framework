---
"@cosmicdrift/kumiko-bundled-features": minor
---

forget-subject shreds note bodies attached to the subject and notes that mention it

<!-- kumiko-changes
feature: crypto-shredding
type: improvement
title: forget-subject shreds note bodies attached to the subject and notes that mention it
detail: |
  `forget-subject` on a user or record subject now also erases the per-note keys of every `note-entry` that hangs on the subject as host entity (entityId, plus entityType for record subjects) or @-mentions it, unless the host entity's retention strategy is anonymize/blockDelete. The automated Art. 17 delete hook reaches notes on the user as host too, and the export lists them. Before, `forget-subject(contact)` left the note bodies readable. Consumer tests that expect readable note bodies after `forget-subject` on a contact (e.g. solon contact-notes-forget) now see the erased sentinel. Forgetting only the author still leaves the bodies readable.
-->
