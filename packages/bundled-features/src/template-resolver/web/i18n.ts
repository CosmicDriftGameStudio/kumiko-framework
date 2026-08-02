// @runtime client
// Default translation bundle for the text-block editor. textBlocksClient()
// hangs it into the LocaleProvider as a fallback bundle — apps override
// individual keys via mergeTranslations at the createKumikoApp level.
//
// Keys follow `template-resolver.editor.<slug>`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "template-resolver.editor.titleLabel": "Titel",
    "template-resolver.editor.contentLabel": "Inhalt",
    "template-resolver.editor.save": "Speichern",
    "template-resolver.editor.saving": "Speichern…",
    "template-resolver.editor.created": "Neu angelegt.",
    "template-resolver.editor.saved": "Gespeichert.",
    "template-resolver.editor.saveFailed": "Speichern fehlgeschlagen.",
    "template-resolver.editor.networkError": "Netzwerkfehler beim Speichern.",
    "template-resolver.editor.loading": "Lädt aktuellen Stand…",
    "template-resolver.editor.loadFailed": "Konnte Block nicht laden",
    "template-resolver.editor.readOnly":
      "Read-only — TenantAdmin- oder SystemAdmin-Rolle für Änderungen erforderlich.",
  },
  en: {
    "template-resolver.editor.titleLabel": "Title",
    "template-resolver.editor.contentLabel": "Content",
    "template-resolver.editor.save": "Save",
    "template-resolver.editor.saving": "Saving…",
    "template-resolver.editor.created": "Created.",
    "template-resolver.editor.saved": "Saved.",
    "template-resolver.editor.saveFailed": "Save failed.",
    "template-resolver.editor.networkError": "Network error while saving.",
    "template-resolver.editor.loading": "Loading current version…",
    "template-resolver.editor.loadFailed": "Could not load block",
    "template-resolver.editor.readOnly":
      "Read-only — TenantAdmin or SystemAdmin role required to make changes.",
  },
};
