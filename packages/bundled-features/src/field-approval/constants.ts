import type { AccessRule } from "@cosmicdrift/kumiko-framework/engine";

export const FIELD_APPROVAL_FEATURE_NAME = "field-approval";

export const FieldApprovalHandlers = {
  requestChange: "field-approval:write:request-change",
  approveChange: "field-approval:write:approve-change",
  rejectChange: "field-approval:write:reject-change",
} as const;

export const FieldApprovalQueries = {
  pendingChanges: "field-approval:query:pending-changes",
} as const;

export const DEFAULT_FIELD_APPROVAL_ROLES = ["TenantAdmin", "TenantMember"] as const;

export const DEFAULT_FIELD_APPROVAL_ACCESS: AccessRule = { roles: DEFAULT_FIELD_APPROVAL_ROLES };

export const FieldChangeStatus = {
  Pending: "pending",
  Approved: "approved",
  Rejected: "rejected",
} as const;

export const FieldApprovalReasons = {
  fieldNotApprovalGated: "field_not_approval_gated",
  invalidValue: "field_change_invalid_value",
  requestNotPending: "field_change_request_not_pending",
  selfApproval: "field_change_self_approval",
  valueErased: "field_change_value_erased",
} as const;
