import { handlerFieldLabelKey, handlerTitleKey } from "@cosmicdrift/kumiko-framework/engine";
import { FormDraftHandlers as H } from "./web/constants.ts";

export const FORM_DRAFT_I18N: Readonly<Record<string, { readonly en: string }>> = {
  [handlerTitleKey(H.discard)]: { en: "Discard draft" },
  [handlerFieldLabelKey(H.discard, "draftKey")]: { en: "Draft" },
  [handlerFieldLabelKey(H.discard, "releaseFiles")]: { en: "Delete uploaded files" },
  [handlerTitleKey(H.save)]: { en: "Save draft" },
  [handlerFieldLabelKey(H.save, "draftKey")]: { en: "Draft" },
  [handlerFieldLabelKey(H.save, "values")]: { en: "Form values" },
  [handlerFieldLabelKey(H.save, "stepIndex")]: { en: "Step" },
};
