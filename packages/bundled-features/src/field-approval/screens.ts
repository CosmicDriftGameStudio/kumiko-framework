import {
  type AccessRule,
  i18nKey,
  MAX_LIST_LIMIT,
  type ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  FIELD_APPROVAL_LIST_SCREEN_ID,
  FieldApprovalHandlers,
  FieldApprovalQueries,
} from "./constants.ts";

const DECISION_PAYLOAD = { pick: ["id", "version"] } as const;

export function createFieldChangeRequestListScreen(
  access: AccessRule,
): ProjectionListScreenDefinition {
  return {
    id: FIELD_APPROVAL_LIST_SCREEN_ID,
    type: "projectionList",
    query: FieldApprovalQueries.pendingChanges,
    // pending-changes returns every open request in one answer.
    pagination: false,
    pageSize: MAX_LIST_LIMIT,
    columns: [
      { field: "recordLabel", label: i18nKey("field-approval.list.col.record") },
      {
        field: "fieldLabel",
        label: i18nKey("field-approval.list.col.field"),
        renderer: { format: "i18nText" },
        cardAbove: true,
      },
      // Each value on its own labelled card line: two IBANs side by side would break mid-value.
      {
        field: "currentValue",
        label: i18nKey("field-approval.list.col.currentValue"),
        cardLabel: true,
      },
      { field: "value", label: i18nKey("field-approval.list.col.value"), cardLabel: true },
      // The query carries the name: a user reference would resolve through the admin-only member directory.
      {
        field: "requestedByName",
        label: i18nKey("field-approval.list.col.requestedBy"),
        narrowInline: true,
        cardLabel: true,
      },
      {
        field: "requestedAt",
        label: i18nKey("field-approval.list.col.requestedAt"),
        narrowInline: true,
        cardLabel: true,
        renderer: { format: "timestamp" },
      },
    ],
    rowActions: [
      {
        id: "approve",
        label: i18nKey("field-approval.list.action.approve"),
        handler: FieldApprovalHandlers.approveChange,
        payload: DECISION_PAYLOAD,
        confirm: i18nKey("field-approval.list.action.approve.confirm"),
        visible: { field: "canApprove", eq: true },
      },
      {
        id: "reject",
        label: i18nKey("field-approval.list.action.reject"),
        handler: FieldApprovalHandlers.rejectChange,
        payload: DECISION_PAYLOAD,
        confirm: i18nKey("field-approval.list.action.reject.confirm"),
        style: "danger",
        visible: { field: "canApprove", eq: true },
      },
      {
        id: "withdraw",
        label: i18nKey("field-approval.list.action.withdraw"),
        handler: FieldApprovalHandlers.rejectChange,
        payload: DECISION_PAYLOAD,
        confirm: i18nKey("field-approval.list.action.withdraw.confirm"),
        style: "danger",
        visible: { field: "filedByCaller", eq: true },
      },
    ],
    access,
  };
}
