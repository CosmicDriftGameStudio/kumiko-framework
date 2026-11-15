type LocalizedString = { readonly en: string; readonly de: string };

export const DOCUMENT_DRAFT_I18N: Readonly<Record<string, LocalizedString>> = {
  "document-draft:feature.label": { en: "Document drafts", de: "Dokumententwürfe" },
  "screen:document-draft-editor.title": { en: "Document draft", de: "Dokumententwurf" },
  "documentDraft.errors.notOpen": {
    en: "This draft is not open for editing.",
    de: "Dieser Entwurf ist nicht zur Bearbeitung offen.",
  },
  "documentDraft.errors.notFinalized": {
    en: "This draft is not finalized.",
    de: "Dieser Entwurf ist nicht abgeschlossen.",
  },
  "documentDraft.errors.templateNotFound": {
    en: "The template {slug} does not exist.",
    de: "Die Vorlage {slug} existiert nicht.",
  },
  "documentDraft.errors.opNotAllowed": {
    en: "The operation {op} is not allowed on a draft: only its text can change.",
    de: "Die Operation {op} ist bei einem Entwurf nicht erlaubt: nur der Text ist änderbar.",
  },
};
