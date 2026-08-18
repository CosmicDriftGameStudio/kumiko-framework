// @runtime client
// Default translation bundle for the folders UI. foldersClient() hangs it into
// the LocaleProvider as a fallback bundle — apps override individual keys via
// foldersClient({ translations: { de: { ... } } }). Keys follow `folders.<area>.<slug>`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  en: {
    "folders.section.createMode": "Save the entity first to pick a folder.",
    "folders.section.loading": "Loading…",
    "folders.section.label": "Folder",
    "folders.section.placeholder": "Select a folder…",
    "folders.section.empty": "No folders found.",
    "folders.section.none": "— No folder —",
    "folders.section.newLabel": "New folder",
    "folders.section.create": "Create & file",
    "folders.section.working": "Saving…",

    "folders.manager.loading": "Loading…",
    "folders.manager.newRoot": "New folder",
    "folders.manager.add": "Create",
    "folders.manager.addChild": "Subfolder",
    "folders.manager.rename": "Rename",
    "folders.manager.delete": "Delete",
    "folders.manager.save": "Save",
    "folders.manager.cancel": "Cancel",
    "folders.manager.working": "Saving…",
    "folders.manager.deleteBlocked": "Remove subfolders first.",
    "folders.manager.deleteConfirmTitle": "Delete folder?",
    "folders.manager.deleteConfirmBody":
      "The folder will be removed. Filed entries move back to Unfiled.",
  },
};
