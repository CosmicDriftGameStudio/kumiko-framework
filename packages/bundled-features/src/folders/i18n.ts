import { handlerFieldLabelKey, handlerTitleKey } from "@cosmicdrift/kumiko-framework/engine";
import { FoldersHandlers as H } from "./web/constants.ts";

// The AI assistant and its approval prompts name a handler by its title key; without
// one the user reads the raw handler name. de/es live in the locale packages.
export const FOLDERS_I18N: Readonly<Record<string, { readonly en: string }>> = {
  [handlerTitleKey(H.clearFolder)]: { en: "Remove from folder" },
  [handlerFieldLabelKey(H.clearFolder, "entityType")]: { en: "Entity type" },
  [handlerFieldLabelKey(H.clearFolder, "entityId")]: { en: "Record" },

  [handlerTitleKey(H.setFolder)]: { en: "Move to folder" },
  [handlerFieldLabelKey(H.setFolder, "folderId")]: { en: "Folder" },
  [handlerFieldLabelKey(H.setFolder, "entityType")]: { en: "Entity type" },
  [handlerFieldLabelKey(H.setFolder, "entityId")]: { en: "Record" },
};
