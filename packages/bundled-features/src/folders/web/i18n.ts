// @runtime client
// Default translation bundle for the folders UI. foldersClient() hangs it into
// the LocaleProvider as a fallback bundle — apps override individual keys via
// foldersClient({ translations: { de: { ... } } }). Keys follow `folders.<area>.<slug>`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "folders.section.createMode": "Speichere zuerst den Eintrag, um einen Ordner zu wählen.",
    "folders.section.loading": "Lädt…",
    "folders.section.label": "Ordner",
    "folders.section.placeholder": "Ordner auswählen…",
    "folders.section.empty": "Keine Ordner gefunden.",
    "folders.section.none": "— Kein Ordner —",
    "folders.section.newLabel": "Neuer Ordner",
    "folders.section.create": "Ordner anlegen & ablegen",
    "folders.section.working": "Speichert…",

    "folders.manager.loading": "Lädt…",
    "folders.manager.empty": "Noch keine Ordner.",
    "folders.manager.newRoot": "Neuer Ordner",
    "folders.manager.add": "Anlegen",
    "folders.manager.addChild": "Unterordner",
    "folders.manager.rename": "Umbenennen",
    "folders.manager.delete": "Löschen",
    "folders.manager.save": "Speichern",
    "folders.manager.cancel": "Abbrechen",
    "folders.manager.working": "Speichert…",
    "folders.manager.deleteBlocked": "Erst Unterordner entfernen.",
  },
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
    "folders.manager.empty": "No folders yet.",
    "folders.manager.newRoot": "New folder",
    "folders.manager.add": "Create",
    "folders.manager.addChild": "Subfolder",
    "folders.manager.rename": "Rename",
    "folders.manager.delete": "Delete",
    "folders.manager.save": "Save",
    "folders.manager.cancel": "Cancel",
    "folders.manager.working": "Saving…",
    "folders.manager.deleteBlocked": "Remove subfolders first.",
  },
};
