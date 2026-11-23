import { translationsByLocaleFromKeys } from "@cosmicdrift/kumiko-renderer";

export const DOCUMENT_DRAFT_EDITOR_I18N = {
  "document-draft:editor.railActions": { en: "Actions", de: "Aktionen" },
  "screen:document-draft-editor.title": { en: "Document draft", de: "Dokumententwurf" },
  "document-draft:editor.infoEdit": {
    en: "Edit the text. The placeholders keep the values the draft was created with.",
    de: "Text bearbeiten. Die Platzhalter behalten die Werte, mit denen der Entwurf angelegt wurde.",
  },
  "document-draft:editor.infoPreview": {
    en: "Preview of the draft text.",
    de: "Vorschau des Entwurfstexts.",
  },
  "document-draft:editor.infoFinalized": {
    en: "This draft is finalized. Reopen it to change the text.",
    de: "Dieser Entwurf ist abgeschlossen. Zum Ändern erneut bearbeiten.",
  },
  "document-draft:editor.loadFailed": {
    en: "The draft could not be loaded.",
    de: "Der Entwurf konnte nicht geladen werden.",
  },
  "document-draft:editor.railTemplate": { en: "Template", de: "Vorlage" },
  "document-draft:editor.template": { en: "Template", de: "Vorlage" },
  "document-draft:editor.variant": { en: "Variant", de: "Variante" },
  "document-draft:editor.revision": { en: "Revision", de: "Revision" },
  "document-draft:editor.file": { en: "File", de: "Datei" },
  "document-draft:editor.railDeviations": {
    en: "Deviations from the template",
    de: "Abweichungen von der Vorlage",
  },
  "document-draft:editor.noDeviations": {
    en: "The draft matches the template.",
    de: "Der Entwurf entspricht der Vorlage.",
  },
  "document-draft:editor.deviation.added": { en: "Added", de: "Hinzugefügt" },
  "document-draft:editor.deviation.removed": { en: "Removed", de: "Entfernt" },
  "document-draft:editor.status.open": { en: "Open", de: "Offen" },
  "document-draft:editor.status.finalized": { en: "Finalized", de: "Abgeschlossen" },
  "document-draft:editor.status.discarded": { en: "Discarded", de: "Verworfen" },
  "document-draft:editor.save": { en: "Save", de: "Speichern" },
  "document-draft:editor.finalize": { en: "Finalize", de: "Abschließen" },
  "document-draft:editor.finalizeNeedsSave": {
    en: "Save your changes before finalizing.",
    de: "Änderungen vor dem Abschließen speichern.",
  },
  "document-draft:editor.discardDraft": { en: "Discard draft", de: "Entwurf verwerfen" },
  "document-draft:editor.back": { en: "Back", de: "Zurück" },
  "document-draft:editor.revise": { en: "Edit again", de: "Erneut bearbeiten" },
  "document-draft:editor.versionConflict": {
    en: "The draft was changed elsewhere in the meantime. Reload it to continue with the current text.",
    de: "Der Entwurf wurde zwischenzeitlich anderswo geändert. Neu laden, um mit dem aktuellen Text weiterzuarbeiten.",
  },
} as const;

export const defaultTranslations = translationsByLocaleFromKeys(DOCUMENT_DRAFT_EDITOR_I18N);
