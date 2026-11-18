---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

The approval list shows who requested a change to approvers who are no admins, and its phone card puts the current and the new value on their own labelled lines. An open request stays visible at its field after a reload and names the requested value, and an empty approval list says that nothing awaits approval. The approval screen and its nav entry now also reach the roles that may file a request, so more people see the "Approvals" entry.

<!-- kumiko-changes
feature: field-approval
type: fix
title: Requester name for every approver, readable phone card, open request at its field
detail: field-approval:query:pending-changes now returns requestedByName, the requester's display name (never the email), so the list no longer depends on the admin-only member directory and shows the name to every approver; requestedBy stays in the row. On the phone card the field label stands above the record, current and new value each take a labelled line, and requester and date share one; the date keeps date and time together. The edit form asks pending-changes for the record's open requests when field-approval is mounted and shows "Awaiting approval" at each such field, also after a reload; the requester sees their own requests, approvers see all they may read. A requester who may write but not read the field sees that the request is open, never its value. A second request on the same field replaces the open one. When the caller may read the requested value, the field says "Requested: DE89… · awaiting approval" (key kumiko.form.fieldApproval.pendingValue, formatted like the field's read-only value, a document field as plain text); a writeOnly field, a reference field (its value is a record id, not a label) and a request without a readable value keep "Awaiting approval". pending-changes masks writeOnly fields like every other read: currentValue, the requested value and the record label come back as true (set) or null, never in plaintext, also for approvers. The approval screen and its nav entry are listed for the union of approverRoles and the feature's access roles (before: approverRoles only, when set), so requesters can find and withdraw their requests; who sees the nav entry changes accordingly, while each row stays filtered (requesters see their own requests, approvers all they may approve, other roles none). The empty approval list reads "No changes awaiting approval." (de, es, fr, it translated). Nothing to do for apps; screenshot tests of the edit form and the approval list change.
-->
