import { handlerFieldLabelKey, handlerTitleKey } from "@cosmicdrift/kumiko-framework/engine";
import { FieldApprovalHandlers as H } from "./constants.ts";

export const FIELD_APPROVAL_I18N: Readonly<Record<string, { readonly en: string }>> = {
  [handlerTitleKey(H.requestChange)]: { en: "Request field change" },
  [handlerFieldLabelKey(H.requestChange, "entityType")]: { en: "Record type" },
  [handlerFieldLabelKey(H.requestChange, "entityId")]: { en: "Record" },
  [handlerFieldLabelKey(H.requestChange, "fieldName")]: { en: "Field" },
  [handlerFieldLabelKey(H.requestChange, "value")]: { en: "New value" },
  "screen:field-change-requests.title": { en: "Changes awaiting approval" },
  "field-approval:nav.fieldChangeRequests": { en: "Approvals" },
  "field-approval.list.col.record": { en: "Record" },
  "field-approval.list.col.field": { en: "Field" },
  "field-approval.list.col.currentValue": { en: "Current value" },
  "field-approval.list.col.value": { en: "New value" },
  "field-approval.list.col.requestedBy": { en: "Requested by" },
  "field-approval.list.col.requestedAt": { en: "Requested at" },
  "field-approval.list.empty": { en: "No changes awaiting approval." },
  "field-approval.list.action.approve": { en: "Approve" },
  "field-approval.list.action.approve.confirm": { en: "Apply this change to the record?" },
  "field-approval.list.action.reject": { en: "Reject" },
  "field-approval.list.action.reject.confirm": {
    en: "Reject this change? The record keeps its current value.",
  },
  "field-approval.list.action.withdraw": { en: "Withdraw" },
  "field-approval.list.action.withdraw.confirm": { en: "Withdraw this change request?" },
};
