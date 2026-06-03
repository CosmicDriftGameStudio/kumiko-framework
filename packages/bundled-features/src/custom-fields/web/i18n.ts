// @runtime client
// Default translation bundle for the custom-fields UI. customFieldsClient()
// hangs it into the LocaleProvider as a fallback bundle — apps override
// individual keys via `customFieldsClient({ translations: { de: { ... } } })`.
//
// Keys follow `custom-fields.<area>.<slug>`. `custom-fields.errors.*` mirror
// the i18nKeys the server-side handlers emit (e.g. `custom-fields:save-failed`).

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "custom-fields.form.createMode": "Speichere zuerst den Eintrag, um Custom-Felder zu setzen.",
    "custom-fields.form.loading": "Lädt…",
    "custom-fields.form.empty": 'Keine Custom-Felder für "{entityName}" definiert.',
    "custom-fields.form.save": "Custom-Felder speichern",
    "custom-fields.form.saving": "Speichert…",
    "custom-fields.errors.loadFailed": "Custom-Felder konnten nicht geladen werden.",
    "custom-fields.errors.saveFailed": "Speichern fehlgeschlagen.",
  },
  en: {
    "custom-fields.form.createMode": "Save the entity first to add custom field values.",
    "custom-fields.form.loading": "Loading…",
    "custom-fields.form.empty": 'No custom fields defined for "{entityName}".',
    "custom-fields.form.save": "Save custom fields",
    "custom-fields.form.saving": "Saving…",
    "custom-fields.errors.loadFailed": "Could not load custom fields.",
    "custom-fields.errors.saveFailed": "Save failed.",
  },
};
