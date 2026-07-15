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
    "kumiko.actions.edit": "Bearbeiten",

    // Version — Update-Awareness-Banner (UpdateChecker).
    "kumiko.version.update-available": "Eine neue Version ist verfügbar.",

    // Toast — Self-service Docs-Link-Default (useToast docsLinkLabel).
    "kumiko.toast.learn-more": "Mehr erfahren",

    // Field — aria-Labels der Date/Timestamp-Primitives.
    "kumiko.field.open-calendar": "Kalender öffnen",
    "kumiko.field.time": "Uhrzeit",
    "kumiko.field.timezone": "Zeitzone",
    "kumiko.field.locatedTzHint": "Zeit lokal am angegebenen Ort",

    // List — DataTable Toolbar, Empty-State, Search.
    "kumiko.list.search-placeholder": "Suchen…",
    "kumiko.list.empty.title": "Noch keine Einträge.",
    "kumiko.list.empty.hint": "Lege den ersten an, um loszulegen.",
    "kumiko.list.no-entries": "Keine Einträge.",

    // Combobox — Tier 2.1c Searchable-Select.
    "kumiko.combobox.search-placeholder": "Suchen…",
    "kumiko.combobox.empty": "Keine Treffer.",
    "kumiko.combobox.loading": "Lade…",

    // Dashboard — Default-Label für den "(alle)"-Eintrag im Screen-Filter,
    // wenn DashboardFilterDefinition.allLabel nicht gesetzt ist.
    "kumiko.dashboard.filter.all": "Alle",
    "kumiko.combobox.placeholder": "—",

    // Widgets — Query-States (QueryTable, LoadingState, ErrorState).
    "kumiko.widget.loading": "Lade…",
    "kumiko.widget.error.title": "Konnte nicht geladen werden.",

    // Nav — Sidebar Tree (Toggle-aria-Labels).
    "kumiko.nav.expand": "Aufklappen",
    "kumiko.nav.collapse": "Zuklappen",
    "kumiko.nav.search": "Navigation durchsuchen…",

    // Dialog — Confirm-Buttons + Close-aria-Label.
    "kumiko.dialog.confirm": "Bestätigen",
    "kumiko.dialog.cancel": "Abbrechen",
    "kumiko.dialog.close": "Schließen",

    // AiTextField/AiTextArea — Ghost-Text-Hint, Toolbar-Aria-Labels, Diff-Dialog.
    "kumiko.aiText.acceptHint": "Tab = übernehmen, Esc = verwerfen",
    "kumiko.aiText.correct": "Korrigieren",
    "kumiko.aiText.translate": "Übersetzen",
    "kumiko.aiText.rewrite": "Umschreiben",
    "kumiko.aiText.diff.before": "Vorher",
    "kumiko.aiText.diff.after": "Nachher",
    "kumiko.aiText.diff.generating": "Wird generiert…",
    "kumiko.aiText.style.formal": "Formell",
    "kumiko.aiText.style.casual": "Locker",
    "kumiko.aiText.style.concise": "Kompakt",
    "kumiko.aiText.style.expand": "Ausführlicher",
    "kumiko.aiText.capExceeded": "Monatliches AI-Limit erreicht.",

    // Row-Actions — Fehler-Toast wenn ein Action-Write fehlschlägt.
    "kumiko.rowAction.failed": "Aktion fehlgeschlagen",

    // Config-Cascade — Source-Badges + Cascade-Panel (ConfigCascadeView).
    "kumiko.config.source.user": "Mein Wert",
    "kumiko.config.source.tenant": "Tenant",
    "kumiko.config.source.system": "System",
    "kumiko.config.source.appOverride": "App-Override",
    "kumiko.config.source.computed": "Berechnet",
    "kumiko.config.source.default": "Standard",
    "kumiko.config.source.missing": "Fehlt",
    "kumiko.config.cascade.noValue": "Kein Wert gesetzt",
    "kumiko.config.cascade.activeMarker": "aktiv",
    "kumiko.config.cascade.resetTo": "Überschreibung zurücksetzen ({scope})",

    // Form — Standard-Errors (App-Code kann eigene zod-Reasons nutzen,
    // diese sind die letzte Sicherheitsschicht).
    "kumiko.form.error.generic": "Etwas ist schiefgegangen.",
    "kumiko.form.error.version-conflict":
      "Datensatz wurde zwischenzeitlich geändert. Lade neu und versuche es erneut.",
    "kumiko.form.extension.save-failed": "Ein Zusatzfeld konnte nicht gespeichert werden.",

    // Validation — Default-Reason-Codes aus dem Framework. App-Code
    // kann eigene Codes via Validation-Hooks reinwerfen; die hier sind
    // die generischen.
    "kumiko.validation.required": "Pflichtfeld.",
    "kumiko.validation.invalid": "Ungültiger Wert.",
    "kumiko.validation.too-short": "Zu kurz (mindestens {min} Zeichen).",
    "kumiko.validation.too-long": "Zu lang (höchstens {max} Zeichen).",
    "kumiko.validation.out-of-range": "Wert außerhalb des erlaubten Bereichs.",

    // errors.validation.* — der kanonische Key-Namespace den Server
    // (ValidationError) und Client (zod-bridge) für Field-Issues
    // erzeugen. Codes = Zod-4-Issue-Codes + Framework-eigene.
    "errors.validation.invalid_type": "Ungültiger Wert.",
    "errors.validation.too_small": "Zu klein oder zu kurz (Minimum: {minimum}).",
    "errors.validation.too_big": "Zu groß oder zu lang (Maximum: {maximum}).",
    "errors.validation.invalid_format": "Ungültiges Format.",
    "errors.validation.not_multiple_of": "Muss ein Vielfaches von {divisor} sein.",
    "errors.validation.unrecognized_keys": "Unbekannte Felder.",
    "errors.validation.invalid_union": "Ungültiger Wert.",
    "errors.validation.invalid_key": "Ungültiger Schlüssel.",
    "errors.validation.invalid_element": "Ungültiger Eintrag.",
    "errors.validation.invalid_value": "Ungültige Auswahl.",
    "errors.validation.custom": "Ungültiger Wert.",
    "errors.validation.unexpected_field": "Unbekanntes Feld.",
    "errors.validation.out_of_bounds": "Wert außerhalb des erlaubten Bereichs.",
    "errors.validation.invalid_option": "Ungültige Auswahl.",
    "errors.validation.failed": "Validierung fehlgeschlagen.",

    // errors.* — Top-Level-Error-Codes (eine pro httpStatus-Klasse). Letzter
    // Fallback wenn eine App keine eigene Übersetzung liefert; bewusst
    // generisch (keine technischen Entity-/Feature-/Key-Namen an End-User —
    // die stecken in `details` für Devs). Apps überschreiben pro Key.
    "errors.feature.disabled": "Diese Funktion ist derzeit nicht verfügbar.",
    "errors.access.denied": "Dazu hast du keine Berechtigung.",
    "errors.notFound": "Nicht gefunden.",
    "errors.conflict": "Konflikt — der Vorgang konnte nicht abgeschlossen werden.",
    "errors.versionConflict":
      "Der Datensatz wurde zwischenzeitlich geändert. Lade neu und versuche es erneut.",
    "errors.uniqueViolation": "Dieser Eintrag existiert bereits.",
    "errors.unprocessable": "Die Anfrage konnte nicht verarbeitet werden.",
    "errors.unconfigured": "Diese Funktion ist noch nicht konfiguriert.",
    "errors.internal": "Etwas ist schiefgegangen. Bitte versuche es später erneut.",
    "errors.rate_limited": "Zu viele Anfragen. Bitte versuche es in Kürze erneut.",
    "errors.download.urlMissing": "Download nicht verfügbar — bitte versuche es erneut.",
  },
  en: {
    "kumiko.actions.save": "Save",
    "kumiko.actions.cancel": "Cancel",
    "kumiko.actions.delete": "Delete",
    "kumiko.actions.delete-confirm": "Confirm delete?",
    "kumiko.actions.reload": "Reload",
    "kumiko.actions.create": "New",
    "kumiko.actions.edit": "Edit",

    "kumiko.version.update-available": "A new version is available.",

    "kumiko.toast.learn-more": "Learn more",

    "kumiko.field.open-calendar": "Open calendar",
    "kumiko.field.time": "Time",
    "kumiko.field.timezone": "Time zone",
    "kumiko.field.locatedTzHint": "Time local to the given location",

    "kumiko.list.search-placeholder": "Search…",
    "kumiko.list.empty.title": "No entries yet.",
    "kumiko.list.empty.hint": "Create the first one to get started.",
    "kumiko.list.no-entries": "No entries.",

    "kumiko.combobox.search-placeholder": "Search…",
    "kumiko.combobox.empty": "No matches.",
    "kumiko.combobox.loading": "Loading…",
    "kumiko.combobox.placeholder": "—",

    "kumiko.dashboard.filter.all": "All",

    "kumiko.widget.loading": "Loading…",
    "kumiko.widget.error.title": "Couldn't load.",

    "kumiko.nav.expand": "Expand",
    "kumiko.nav.collapse": "Collapse",
    "kumiko.nav.search": "Search navigation…",

    "kumiko.dialog.confirm": "Confirm",
    "kumiko.dialog.cancel": "Cancel",
    "kumiko.dialog.close": "Close",

    "kumiko.aiText.acceptHint": "Tab = accept, Esc = discard",
    "kumiko.aiText.correct": "Correct",
    "kumiko.aiText.translate": "Translate",
    "kumiko.aiText.rewrite": "Rewrite",
    "kumiko.aiText.diff.before": "Before",
    "kumiko.aiText.diff.after": "After",
    "kumiko.aiText.diff.generating": "Generating…",
    "kumiko.aiText.style.formal": "Formal",
    "kumiko.aiText.style.casual": "Casual",
    "kumiko.aiText.style.concise": "Concise",
    "kumiko.aiText.style.expand": "Expand",
    "kumiko.aiText.capExceeded": "Monthly AI limit reached.",

    "kumiko.rowAction.failed": "Action failed",

    "kumiko.config.source.user": "My value",
    "kumiko.config.source.tenant": "Tenant",
    "kumiko.config.source.system": "System",
    "kumiko.config.source.appOverride": "App override",
    "kumiko.config.source.computed": "Computed",
    "kumiko.config.source.default": "Default",
    "kumiko.config.source.missing": "Missing",
    "kumiko.config.cascade.noValue": "No value set",
    "kumiko.config.cascade.activeMarker": "active",
    "kumiko.config.cascade.resetTo": "Reset override ({scope})",

    "kumiko.form.error.generic": "Something went wrong.",
    "kumiko.form.error.version-conflict":
      "Record was modified in the meantime. Reload and try again.",
    "kumiko.form.extension.save-failed": "A custom field could not be saved.",

    "kumiko.validation.required": "Required.",
    "kumiko.validation.invalid": "Invalid value.",
    "kumiko.validation.too-short": "Too short (at least {min} characters).",
    "kumiko.validation.too-long": "Too long (at most {max} characters).",
    "kumiko.validation.out-of-range": "Value out of allowed range.",

    "errors.validation.invalid_type": "Invalid value.",
    "errors.validation.too_small": "Too small or too short (minimum: {minimum}).",
    "errors.validation.too_big": "Too big or too long (maximum: {maximum}).",
    "errors.validation.invalid_format": "Invalid format.",
    "errors.validation.not_multiple_of": "Must be a multiple of {divisor}.",
    "errors.validation.unrecognized_keys": "Unknown fields.",
    "errors.validation.invalid_union": "Invalid value.",
    "errors.validation.invalid_key": "Invalid key.",
    "errors.validation.invalid_element": "Invalid entry.",
    "errors.validation.invalid_value": "Invalid choice.",
    "errors.validation.custom": "Invalid value.",
    "errors.validation.unexpected_field": "Unknown field.",
    "errors.validation.out_of_bounds": "Value out of allowed range.",
    "errors.validation.invalid_option": "Invalid choice.",
    "errors.validation.failed": "Validation failed.",

    "errors.feature.disabled": "This feature is currently unavailable.",
    "errors.access.denied": "You don't have permission to do this.",
    "errors.notFound": "Not found.",
    "errors.conflict": "Conflict — the operation could not be completed.",
    "errors.versionConflict": "The record was modified in the meantime. Reload and try again.",
    "errors.uniqueViolation": "This entry already exists.",
    "errors.unprocessable": "The request could not be processed.",
    "errors.unconfigured": "This feature isn't configured yet.",
    "errors.internal": "Something went wrong. Please try again later.",
    "errors.rate_limited": "Too many requests. Please try again shortly.",
    "errors.download.urlMissing": "Download unavailable — please try again.",
  },
};
