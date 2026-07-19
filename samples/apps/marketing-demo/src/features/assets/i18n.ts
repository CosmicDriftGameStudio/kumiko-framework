// Assets-Feature i18n-Bundle. Convention: feature-prefix `assets:`
// + `entity:asset:field:<name>` für Field-Labels (Spalten + Form),
// `screen:<id>.title` für Page-Titles, `assets:nav.<id>` für
// Sidebar-Labels.
//
// Plus: Select-Options bekommen lesbare Labels via
// `assets:entity:asset:field:<field>:option:<value>` damit „lent"
// nicht raw als „lent" im Screenshot landet.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const assetsTranslations: TranslationsByLocale = {
  de: {
    "assets:nav.list": "Assets",
    "assets:nav.new": "Neues Asset",
    "assets:actions.edit": "Bearbeiten",

    "screen:asset-list.title": "Assets",
    "screen:asset-edit.title": "Asset bearbeiten",

    "assets:entity:asset:field:name": "Name",
    "assets:entity:asset:field:type": "Typ",
    "assets:entity:asset:field:status": "Status",
    "assets:entity:asset:field:department": "Abteilung",
    "assets:entity:asset:field:owner": "Ausgeliehen an",
    "assets:entity:asset:field:location": "Standort",
    "assets:entity:asset:field:serialNumber": "Seriennummer",
    "assets:entity:asset:field:vendor": "Lieferant",
    "assets:entity:asset:field:price": "Anschaffungswert",
    "assets:entity:asset:field:purchaseDate": "Kaufdatum",
    "assets:entity:asset:field:warrantyUntil": "Garantie bis",
    "assets:entity:asset:field:notes": "Notizen",

    "assets:entity:asset:field:type:option:laptop": "Laptop",
    "assets:entity:asset:field:type:option:monitor": "Monitor",
    "assets:entity:asset:field:type:option:phone": "Telefon",
    "assets:entity:asset:field:type:option:tool": "Werkzeug",
    "assets:entity:asset:field:type:option:license": "Lizenz",
    "assets:entity:asset:field:type:option:other": "Sonstiges",

    "assets:entity:asset:field:status:option:available": "Verfügbar",
    "assets:entity:asset:field:status:option:lent": "Ausgeliehen",
    "assets:entity:asset:field:status:option:maintenance": "In Wartung",
    "assets:entity:asset:field:status:option:broken": "Defekt",

    "assets:entity:asset:field:department:option:it": "IT",
    "assets:entity:asset:field:department:option:marketing": "Marketing",
    "assets:entity:asset:field:department:option:sales": "Vertrieb",
    "assets:entity:asset:field:department:option:engineering": "Entwicklung",
    "assets:entity:asset:field:department:option:finance": "Finanzen",
    "assets:entity:asset:field:department:option:hr": "Personal",
    "assets:entity:asset:field:department:option:shared": "Geteilt",

    "assets:section.basics": "Stammdaten",
    "assets:section.assignment": "Zuordnung",
    "assets:section.purchase": "Einkauf",
  },
  en: {
    "assets:nav.list": "Assets",
    "assets:nav.new": "New asset",
    "assets:actions.edit": "Edit",

    "screen:asset-list.title": "Assets",
    "screen:asset-edit.title": "Edit asset",

    "assets:entity:asset:field:name": "Name",
    "assets:entity:asset:field:type": "Type",
    "assets:entity:asset:field:status": "Status",
    "assets:entity:asset:field:department": "Department",
    "assets:entity:asset:field:owner": "Lent to",
    "assets:entity:asset:field:location": "Location",
    "assets:entity:asset:field:serialNumber": "Serial number",
    "assets:entity:asset:field:vendor": "Vendor",
    "assets:entity:asset:field:price": "Purchase price",
    "assets:entity:asset:field:purchaseDate": "Purchase date",
    "assets:entity:asset:field:warrantyUntil": "Warranty until",
    "assets:entity:asset:field:notes": "Notes",

    "assets:entity:asset:field:type:option:laptop": "Laptop",
    "assets:entity:asset:field:type:option:monitor": "Monitor",
    "assets:entity:asset:field:type:option:phone": "Phone",
    "assets:entity:asset:field:type:option:tool": "Tool",
    "assets:entity:asset:field:type:option:license": "License",
    "assets:entity:asset:field:type:option:other": "Other",

    "assets:entity:asset:field:status:option:available": "Available",
    "assets:entity:asset:field:status:option:lent": "Lent out",
    "assets:entity:asset:field:status:option:maintenance": "Maintenance",
    "assets:entity:asset:field:status:option:broken": "Broken",

    "assets:entity:asset:field:department:option:it": "IT",
    "assets:entity:asset:field:department:option:marketing": "Marketing",
    "assets:entity:asset:field:department:option:sales": "Sales",
    "assets:entity:asset:field:department:option:engineering": "Engineering",
    "assets:entity:asset:field:department:option:finance": "Finance",
    "assets:entity:asset:field:department:option:hr": "HR",
    "assets:entity:asset:field:department:option:shared": "Shared",

    "assets:section.basics": "Basics",
    "assets:section.assignment": "Assignment",
    "assets:section.purchase": "Purchase",
  },
};
