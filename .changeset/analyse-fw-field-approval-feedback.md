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
detail: field-approval:query:pending-changes now returns requestedByName, the requester's display name (never the email), so the list no longer depends on the admin-only member directory and shows the name to every approver; requestedBy stays in the row. On the phone card the field label stands above the record, current and new value each take a labelled line, and requester and date share one; the date keeps date and time together. The edit form asks pending-changes for the record's open requests when field-approval is mounted and shows "Awaiting approval" at each such field, also after a reload; the requester sees their own requests, approvers see all they may read. A requester who may write but not read the field sees that the request is open, never its value. A requester's second request on the same field replaces their own open one. When the caller may read the requested value, the field says "Requested: DE89… · awaiting approval" (key kumiko.form.fieldApproval.pendingValue, formatted like the field's read-only value, a document field as plain text); a writeOnly field, a reference field (its value is a record id, not a label) and a request without a readable value keep "Awaiting approval". pending-changes masks writeOnly fields like every other read: currentValue, the requested value and the record label come back as true (set) or null, never in plaintext, also for approvers. The approval screen and its nav entry are listed for the union of approverRoles and the feature's access roles (before: approverRoles only, when set), so requesters can find and withdraw their requests; who sees the nav entry changes accordingly, while each row stays filtered (requesters see their own requests, approvers all they may approve, other roles none). The empty approval list reads "No changes awaiting approval." (de, es, fr, it translated). Nothing to do for apps; screenshot tests of the edit form and the approval list change.
-->

<!-- kumiko-changes
feature: field-approval
type: fix
title: A request no longer silently replaces someone else's open request
detail: field-approval:write:request-change overwrote another user's open request on the same field and made the caller its requester, so the first requester lost the request without notice. It now fails with reason field_change_request_pending_by_other (i18n key errors.fieldApproval.requestPendingByOther, en, de, es, fr, it); the caller's own open request can still be changed, and approvers still write the field directly. Re-filing pins the version the handler checked, so two requests filed at the same moment on a decided request end in a version conflict for the second instead of one replacing the other. On a record (pending-changes with an entityId) a writer who would have to request the field gets a row for another user's open request without value, current value, requester or name (canApprove and filedByCaller false); the approval list without an entityId is unchanged. The edit form shows "A change request for this field is awaiting approval" (key kumiko.form.fieldApproval.pendingByOther) at such a field instead of "Request change", and the request drawer leaves the field out. Apps whose tests expect no rows from pending-changes for such a writer on a record now get that one row without value.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Withdraw runs once, a refused config reset shows its error
detail: "Withdraw request" is disabled while its call runs, so a double click no longer sends a second reject-change that failed after the first had withdrawn the request. A config screen reset that is written at once (an override equal to the inherited value) ignored a refused write and reloaded the cascade; it now shows the error like a refused save and reloads nothing. RenderEditControls gains showSubmitError(error), which shows the failure of a write the host ran outside submit the way a failed save shows. Nothing to do for apps.
-->
