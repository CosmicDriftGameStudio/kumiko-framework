import { handlerFieldLabelKey, handlerTitleKey } from "@cosmicdrift/kumiko-framework/engine";
import { FieldApprovalHandlers as H } from "./constants.ts";

export const FIELD_APPROVAL_I18N: Readonly<Record<string, { readonly en: string }>> = {
  [handlerTitleKey(H.requestChange)]: { en: "Request field change" },
  [handlerFieldLabelKey(H.requestChange, "entityType")]: { en: "Record type" },
  [handlerFieldLabelKey(H.requestChange, "entityId")]: { en: "Record" },
  [handlerFieldLabelKey(H.requestChange, "fieldName")]: { en: "Field" },
  [handlerFieldLabelKey(H.requestChange, "value")]: { en: "New value" },
};
