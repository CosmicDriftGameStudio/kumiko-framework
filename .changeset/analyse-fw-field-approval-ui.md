---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Field approval gets its UI. An edit form that hits `field_approval_required` keeps every input, names the gated fields in the banner and offers "Submit for approval", which files the new values with `field-approval:write:request-change`, saves the rest and marks the fields "Awaiting approval". The `field-approval` feature now ships the screen `field-approval:screen:field-change-requests` with approve, reject and withdraw row actions and a nav entry in the tenant admin area.

<!-- kumiko-changes
feature: field-approval
type: improvement
title: Edit form and approval list for field approval
detail: An edit form denied with field_approval_required keeps the inputs, lists the gated fields by label and, when field-approval is mounted, offers "Submit for approval": it files each gated value with field-approval:write:request-change, restores the saved value with an "Awaiting approval" hint and saves the remaining changes. Without the feature only the hint shows. createFieldApprovalFeature registers the list field-approval:screen:field-change-requests (record, field, current and new value, requester, time; approve and reject for approvers, withdraw for the requester) and the nav entry field-approval:nav:field-change-requests in the tenant admin area. Values only show to callers who may read the field. Nothing to do for apps; approverRoles limits the list to approver roles and nav: { parent, order, workspaces, adminArea } moves the entry.
-->
