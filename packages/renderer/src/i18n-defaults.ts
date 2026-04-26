// Framework-Default-Bundle. Strings die die Renderer-Components hart
// brauchen (Save/Cancel/Delete-Buttons, Empty-States, Search-Placeholder,
// Nav-Toggle-aria-Labels, Validation-Reasons). createKumikoApp hängt das
// als ALLERLETZTEN Fallback in den LocaleProvider — Apps können
// einzelne Keys via clientFeatures.translations überschreiben.
//
// Convention: alle Keys mit `kumiko.`-Prefix damit sie nicht mit
// App-Keys kollidieren. Sub-Pfade gruppieren nach Bereich (actions /
// list / nav / form / validation).

import type { TranslationsByLocale } from "./i18n";

export const kumikoDefaultTranslations: TranslationsByLocale = {
  de: {
    // Actions — Buttons in RenderEdit, RenderList, Confirm-Dialogen.
    "kumiko.actions.save": "Speichern",
    "kumiko.actions.cancel": "Abbrechen",
    "kumiko.actions.delete": "Löschen",
    "kumiko.actions.delete-confirm": "Wirklich löschen?",
    "kumiko.actions.reload": "Neu laden",
    "kumiko.actions.create": "Neu",

    // List — DataTable Toolbar, Empty-State, Search.
    "kumiko.list.search-placeholder": "Suchen…",
    "kumiko.list.empty.title": "Noch keine Einträge.",
    "kumiko.list.empty.hint": "Lege den ersten an, um loszulegen.",
    "kumiko.list.no-entries": "Keine Einträge.",

    // Nav — Sidebar Tree (Toggle-aria-Labels).
    "kumiko.nav.expand": "Aufklappen",
    "kumiko.nav.collapse": "Zuklappen",

    // Form — Standard-Errors (App-Code kann eigene zod-Reasons nutzen,
    // diese sind die letzte Sicherheitsschicht).
    "kumiko.form.error.generic": "Etwas ist schiefgegangen.",
    "kumiko.form.error.version-conflict":
      "Datensatz wurde zwischenzeitlich geändert. Lade neu und versuche es erneut.",

    // Validation — Default-Reason-Codes aus dem Framework. App-Code
    // kann eigene Codes via Validation-Hooks reinwerfen; die hier sind
    // die generischen.
    "kumiko.validation.required": "Pflichtfeld.",
    "kumiko.validation.invalid": "Ungültiger Wert.",
    "kumiko.validation.too-short": "Zu kurz (mindestens {min} Zeichen).",
    "kumiko.validation.too-long": "Zu lang (höchstens {max} Zeichen).",
    "kumiko.validation.out-of-range": "Wert außerhalb des erlaubten Bereichs.",
  },
  en: {
    "kumiko.actions.save": "Save",
    "kumiko.actions.cancel": "Cancel",
    "kumiko.actions.delete": "Delete",
    "kumiko.actions.delete-confirm": "Confirm delete?",
    "kumiko.actions.reload": "Reload",
    "kumiko.actions.create": "New",

    "kumiko.list.search-placeholder": "Search…",
    "kumiko.list.empty.title": "No entries yet.",
    "kumiko.list.empty.hint": "Create the first one to get started.",
    "kumiko.list.no-entries": "No entries.",

    "kumiko.nav.expand": "Expand",
    "kumiko.nav.collapse": "Collapse",

    "kumiko.form.error.generic": "Something went wrong.",
    "kumiko.form.error.version-conflict":
      "Record was modified in the meantime. Reload and try again.",

    "kumiko.validation.required": "Required.",
    "kumiko.validation.invalid": "Invalid value.",
    "kumiko.validation.too-short": "Too short (at least {min} characters).",
    "kumiko.validation.too-long": "Too long (at most {max} characters).",
    "kumiko.validation.out-of-range": "Value out of allowed range.",
  },
};
