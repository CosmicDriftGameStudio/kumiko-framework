// @runtime client
// Default translation bundle for the notes-history UI. notesHistoryClient()
// hangs it into the LocaleProvider as a fallback bundle — apps override
// individual keys via notesHistoryClient({ translations }).
// Keys follow `notesHistory.<area>.<slug>`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  en: {
    "notesHistory.section.createMode": "Save the entity first to add notes.",
    "notesHistory.section.loading": "Loading…",
    "notesHistory.section.empty": "No notes yet.",
    "notesHistory.section.working": "Saving…",
    "notesHistory.section.add": "Add note",
    "notesHistory.section.meta": "{author} · {date}",
    "notesHistory.section.authorUnknown": "Unknown author",
  },
};
