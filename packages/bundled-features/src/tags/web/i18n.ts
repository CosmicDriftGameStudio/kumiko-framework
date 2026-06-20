// @runtime client
// Default translation bundle for the tags UI. tagsClient() hangs it into the
// LocaleProvider as a fallback bundle — apps override individual keys via
// tagsClient({ translations: { de: { ... } } }). Keys follow `tags.<area>.<slug>`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "tags.section.createMode": "Speichere zuerst den Eintrag, um Tags zu setzen.",
    "tags.section.loading": "Lädt…",
    "tags.section.none": "Keine Tags.",
    "tags.section.newLabel": "Neuer Tag",
    "tags.section.create": "Tag anlegen & zuweisen",
    "tags.section.working": "Speichert…",
  },
  en: {
    "tags.section.createMode": "Save the entity first to add tags.",
    "tags.section.loading": "Loading…",
    "tags.section.none": "No tags.",
    "tags.section.newLabel": "New tag",
    "tags.section.create": "Create & attach tag",
    "tags.section.working": "Saving…",
  },
};
