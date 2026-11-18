---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

The field approval says things once. The edit form shows one warning banner that names the gated fields and offers "Submit for approval"; the field itself only carries a "Needs approval" marker instead of an error text, and submitting confirms with a success notice. The approval list shows who requested a change to approvers who are no admins, and its phone card puts the current and the new value on their own labelled lines. An open request stays visible at its field after a reload, and an empty approval list says that nothing awaits approval.

<!-- kumiko-changes
feature: field-approval
type: fix
title: Field approval hint once, requester name for every approver, readable phone card
detail: A save denied with field_approval_required shows one warning banner ("Changes to IBAN need approval.") with the submit action; the gated field gets a "Needs approval" status marker instead of a repeated error text, and "Submit for approval" ends with a success notice through the app's action notifier. field-approval:query:pending-changes now returns requestedByName, the requester's display name (never the email), so the list no longer depends on the admin-only member directory and shows the name to every approver; requestedBy stays in the row. On the phone card the field label stands above the record, current and new value each take a labelled line, and requester and date share one; the date keeps date and time together. The edit form asks pending-changes for the record's open requests when field-approval is mounted and shows "Awaiting approval" at each such field, also after a reload; the requester sees their own requests, approvers see all they may read. A requester who may write but not read the field sees that the request is open, never its value. A second request on the same field replaces the open one. The empty approval list reads "No changes awaiting approval." (de, es, fr, it translated). Nothing to do for apps; screenshot tests of the edit form and the approval list change.
-->
