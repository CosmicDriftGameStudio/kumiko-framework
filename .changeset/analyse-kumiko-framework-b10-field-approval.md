---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Fields can require a second person's approval. `access: { approve: ["Accountant"] }` on a field makes the executor refuse a create or update that changes it by anyone without an approve role (403, reason `field_approval_required`). The new `field-approval` feature (`createFieldApprovalFeature({ parents })`) stores the change as a request, encrypted under the host record's subject, and a different approver applies it with `approve-change`. Boot rules check that approve roles may write the field, that the field is scalar and top-level, and that the feature is mounted with the entity among its parents.

<!-- kumiko-changes
feature: field-approval
type: feature
title: Four-eyes approval for payment-relevant fields
detail: Declare access.approve on a field and mount createFieldApprovalFeature({ parents }). Direct changes by non-approvers return 403 field_approval_required; file them with field-approval:write:request-change and decide them with approve-change or reject-change. field-approval:query:pending-changes lists open requests with their value.
-->
