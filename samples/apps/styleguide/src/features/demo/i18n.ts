import type { LocalizedString } from "../shared-i18n";

// screen:item-edit.title is the breadcrumb key (shell-breadcrumb.ts reads
// `screen:<id>.title`); .create./.edit. variants are entityEdit's form header.
export const DEMO_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:item-edit.title": { de: "Element bearbeiten", en: "Edit item" },
  "screen:item-edit.create.title": { de: "Element anlegen", en: "Create item" },
  "screen:item-edit.create.subtitle": {
    de: "Füge deinem Katalog ein neues Element hinzu.",
    en: "Add a new item to your catalog.",
  },
  "screen:item-edit.edit.title": { de: "Element bearbeiten", en: "Edit item" },
  "screen:item-edit.edit.subtitle": {
    de: "Aktualisiere dieses Element in deinem Katalog.",
    en: "Update this item in your catalog.",
  },
  "screen:item-list.title": { de: "Artikel", en: "Items" },
  "styleguide:entity:item:field:name": { de: "Name", en: "Name" },
  "styleguide:entity:item:field:description": { de: "Beschreibung", en: "Description" },
  "styleguide:entity:item:field:quantity": { de: "Menge", en: "Quantity" },
  "styleguide:entity:item:field:rating": { de: "Bewertung", en: "Rating" },
  "styleguide:entity:item:field:isActive": { de: "Aktiv", en: "Active" },
  "styleguide:entity:item:field:isActive:option:true": { de: "Aktiv", en: "Active" },
  "styleguide:entity:item:field:isActive:option:false": { de: "Inaktiv", en: "Inactive" },
  "styleguide:entity:item:field:status": { de: "Status", en: "Status" },
  "styleguide:entity:item:field:status:option:draft": { de: "Entwurf", en: "Draft" },
  "styleguide:entity:item:field:status:option:review": { de: "Prüfung", en: "Review" },
  "styleguide:entity:item:field:status:option:published": { de: "Veröffentlicht", en: "Published" },
  "styleguide:entity:item:field:status:option:archived": { de: "Archiviert", en: "Archived" },
  "styleguide:entity:item:field:publishedAt": { de: "Veröffentlicht am", en: "Published at" },
  "styleguide:entity:item:field:price": { de: "Preis", en: "Price" },
};
