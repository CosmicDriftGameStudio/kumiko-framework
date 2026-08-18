// @runtime client
// Default translation bundle for the notes-history UI. notesHistoryClient()
// hangs it into the LocaleProvider as a fallback bundle — apps override
// individual keys via notesHistoryClient({ translations: { de: { ... } } }).
// Keys follow `notesHistory.<area>.<slug>`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "notesHistory.section.createMode": "Speichere zuerst den Eintrag, um Notizen anzulegen.",
    "notesHistory.section.loading": "Lädt…",
    "notesHistory.section.empty": "Noch keine Notizen.",
    "notesHistory.section.working": "Speichert…",
    "notesHistory.section.add": "Notiz hinzufügen",
    "notesHistory.section.meta": "{author} · {date}",
  },
  en: {
    "notesHistory.section.createMode": "Save the entity first to add notes.",
    "notesHistory.section.loading": "Loading…",
    "notesHistory.section.empty": "No notes yet.",
    "notesHistory.section.working": "Saving…",
    "notesHistory.section.add": "Add note",
    "notesHistory.section.meta": "{author} · {date}",
  },
  es: {
    "notesHistory.section.createMode": "Guarda primero la entrada para poder añadir notas.",
    "notesHistory.section.loading": "Cargando…",
    "notesHistory.section.empty": "Aún no hay notas.",
    "notesHistory.section.working": "Guardando…",
    "notesHistory.section.add": "Añadir nota",
    "notesHistory.section.meta": "{author} · {date}",
  },
};
