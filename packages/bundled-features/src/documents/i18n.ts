type LocalizedString = { readonly en: string; readonly de: string };

export const DOCUMENTS_FEATURE_I18N: Readonly<Record<string, LocalizedString>> = {
  "documents:feature.label": { en: "Documents", de: "Dokumente" },
  "screen:list.title": { en: "Documents", de: "Dokumente" },
  "documents:tab.title": { en: "Documents", de: "Dokumente" },
  "documents:overview.expired": { en: "Expired documents", de: "Abgelaufene Dokumente" },
  "documents:overview.expiring": { en: "Documents expiring soon", de: "Bald ablaufende Dokumente" },
  "documents:entity:document:field:title": { en: "Title", de: "Titel" },
  "documents:entity:document:field:category": { en: "Category", de: "Kategorie" },
  "documents:entity:document:field:issuedAt": { en: "Issued", de: "Ausgestellt" },
  "documents:entity:document:field:validUntil": { en: "Valid until", de: "Gültig bis" },
  "documents:entity:document:field:file": { en: "File", de: "Datei" },
  "documents.errors.unknown-category": {
    en: "Unknown document category",
    de: "Unbekannte Dokumentenkategorie",
  },
  "documents.errors.unknown-link-target": {
    en: "This record type takes no documents",
    de: "Diesem Datensatztyp lassen sich keine Dokumente zuordnen",
  },
};
