import type {
  ClientFeatureDefinition,
  TranslationsByLocale,
} from "@cosmicdrift/kumiko-renderer-web";

// Feld-Labels: ohne Übersetzung rendert der Renderer den rohen Key
// (styleguide:entity:item:field:name). Diese Bundle liefert lesbare Labels;
// gleiche Keys decken auch die List-Spaltenköpfe ab. en + de sind bewusst
// unterschiedlich, damit der Screenshot-Locale-Switch sichtbar greift.
const en: Record<string, string> = {
  // create/edit-bewusster Form-Header (Titel + muted Subtitle) statt des
  // generischen "Edit item".
  "screen:item-edit.create.title": "Create item",
  "screen:item-edit.create.subtitle": "Add a new item to your catalog.",
  "screen:item-edit.edit.title": "Edit item",
  "screen:item-edit.edit.subtitle": "Update this item in your catalog.",
  "screen:item-list.title": "Items",
  "styleguide:entity:item:field:name": "Name",
  "styleguide:entity:item:field:description": "Description",
  "styleguide:entity:item:field:quantity": "Quantity",
  "styleguide:entity:item:field:rating": "Rating",
  "styleguide:entity:item:field:isActive": "Active",
  "styleguide:entity:item:field:status": "Status",
  "styleguide:entity:item:field:publishedAt": "Published at",
  "styleguide:entity:item:field:price": "Price",
  // Status-Option-Labels — decken Spalte UND Facet-Dropdown ab.
  "styleguide:entity:item:field:status:option:draft": "Draft",
  "styleguide:entity:item:field:status:option:review": "Review",
  "styleguide:entity:item:field:status:option:published": "Published",
  "styleguide:entity:item:field:status:option:archived": "Archived",
};

const de: Record<string, string> = {
  "screen:item-edit.create.title": "Element anlegen",
  "screen:item-edit.create.subtitle": "Füge deinem Katalog ein neues Element hinzu.",
  "screen:item-edit.edit.title": "Element bearbeiten",
  "screen:item-edit.edit.subtitle": "Aktualisiere dieses Element in deinem Katalog.",
  "screen:item-list.title": "Artikel",
  "styleguide:entity:item:field:name": "Name",
  "styleguide:entity:item:field:description": "Beschreibung",
  "styleguide:entity:item:field:quantity": "Menge",
  "styleguide:entity:item:field:rating": "Bewertung",
  "styleguide:entity:item:field:isActive": "Aktiv",
  "styleguide:entity:item:field:status": "Status",
  "styleguide:entity:item:field:publishedAt": "Veröffentlicht am",
  "styleguide:entity:item:field:price": "Preis",
  "styleguide:entity:item:field:status:option:draft": "Entwurf",
  "styleguide:entity:item:field:status:option:review": "Prüfung",
  "styleguide:entity:item:field:status:option:published": "Veröffentlicht",
  "styleguide:entity:item:field:status:option:archived": "Archiviert",
};

const translations: TranslationsByLocale = { en, de };

export const styleguideClient: ClientFeatureDefinition = {
  name: "styleguide",
  translations,
};
