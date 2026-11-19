import { handlerFieldLabelKey, handlerTitleKey } from "@cosmicdrift/kumiko-framework/engine";
import { NotesHistoryHandlers as H } from "./web/constants.ts";

type LocalizedString = { readonly en: string };

export const NOTES_HISTORY_FEATURE_I18N: Readonly<Record<string, LocalizedString>> = {
  [handlerTitleKey(H.addNote)]: { en: "Add note" },
  [handlerFieldLabelKey(H.addNote, "entityType")]: { en: "Record type" },
  [handlerFieldLabelKey(H.addNote, "entityId")]: { en: "Record" },
  [handlerFieldLabelKey(H.addNote, "body")]: { en: "Note" },
  [handlerFieldLabelKey(H.addNote, "mentions")]: { en: "Mentioned users" },
};
