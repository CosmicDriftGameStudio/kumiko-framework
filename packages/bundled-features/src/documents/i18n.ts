type LocalizedString = { readonly en: string; readonly de: string };

export const DOCUMENTS_FEATURE_I18N: Readonly<Record<string, LocalizedString>> = {
  "documents:feature.label": { en: "Documents", de: "Dokumente" },
  "screen:list.title": { en: "Documents", de: "Dokumente" },
  "documents:tab.title": { en: "Documents", de: "Dokumente" },
  "documents:overview.expired": { en: "Expired documents", de: "Abgelaufene Dokumente" },
  "documents:overview.expiring": { en: "Documents expiring soon", de: "Bald ablaufende Dokumente" },
  "documents:entity:filed-document:field:title": { en: "Title", de: "Titel" },
  "documents:entity:filed-document:field:category": { en: "Category", de: "Kategorie" },
  "documents:entity:filed-document:field:issuedAt": { en: "Issued", de: "Ausgestellt" },
  "documents:entity:filed-document:field:validUntil": { en: "Valid until", de: "Gültig bis" },
  "documents:entity:filed-document:field:file": { en: "File", de: "Datei" },
  "documents:list.facet.expiry": { en: "Expiry", de: "Ablauf" },
  "documents:list.facet.expiring": {
    en: "Expired or expiring soon",
    de: "Abgelaufen oder bald ablaufend",
  },
  "documents:list.expiry.expired": { en: "Expired", de: "Abgelaufen" },
  "documents:list.expiry.expiring": { en: "Expiring soon", de: "Läuft bald ab" },
  "documents:list.expiry.valid": { en: "Valid", de: "Gültig" },
  "documents:list.expiry.none": { en: "No expiry date", de: "Ohne Ablaufdatum" },
  "documents:write:link:title": {
    en: "Link document to record",
    de: "Dokument mit Datensatz verknüpfen",
  },
  "documents:write:link:field:documentId": { en: "Document", de: "Dokument" },
  "documents:write:link:field:entityType": { en: "Record type", de: "Datensatztyp" },
  "documents:write:link:field:entityId": { en: "Record", de: "Datensatz" },
  "documents:write:unlink:title": {
    en: "Remove document from record",
    de: "Dokument von Datensatz lösen",
  },
  "documents:write:unlink:field:documentId": { en: "Document", de: "Dokument" },
  "documents:write:unlink:field:entityType": { en: "Record type", de: "Datensatztyp" },
  "documents:write:unlink:field:entityId": { en: "Record", de: "Datensatz" },
  "documents.errors.unknown-category": {
    en: "Unknown document category",
    de: "Unbekannte Dokumentenkategorie",
  },
  "documents.errors.unknown-link-target": {
    en: "This record type takes no documents",
    de: "Diesem Datensatztyp lassen sich keine Dokumente zuordnen",
  },
  "documents.errors.import-id-taken": {
    en: "This id already belongs to another record",
    de: "Diese ID gehört bereits zu einem anderen Datensatz",
  },
};
