---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Field approval gets its UI. A form keeps one Save: a user who may write but not approve a gated field sees it read-only with "Request change", and a drawer files the changed gated fields in one batch with "Submit for approval". An open request shows "Requested: <value> · awaiting approval" under the field and, for its requester, "Withdraw request". Approvers edit the field directly. A save the server still refuses shows a field error only. The `field-approval` feature ships the screen `field-approval:screen:field-change-requests` with approve, reject and withdraw row actions and a nav entry in the tenant admin area.

<!-- kumiko-changes
feature: field-approval
type: fix
title: Approval-gated fields are read-only with a request drawer
detail: Approval-gated fields are read-only with a request drawer. A user who may write but not approve a gated field sees it read-only with 'Request change'; the drawer lists all such fields of the form and files only changed ones in one batch with 'Submit for approval'. An open request shows 'Requested: <value> · awaiting approval' and, for its requester, 'Withdraw request'. pending-changes returns gatedFields for an entityType; entityId null answers for a record not created yet. A denied save shows a field error only. createFieldApprovalFeature registers the list field-approval:screen:field-change-requests (record, field, current and new value, requester, time; approve and reject for approvers, withdraw for the requester) and the nav entry field-approval:nav:field-change-requests in the tenant admin area. Values only show to callers who may read the field. Nothing to do for apps; approverRoles adds approver roles to the list and nav: { parent, order, workspaces, adminArea } moves the entry.
-->
