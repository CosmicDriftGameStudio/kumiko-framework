import {
  createBooleanField,
  createDateField,
  createEntity,
  createMoneyField,
  createNumberField,
  createSelectField,
  createTextField,
  defineFeature,
  registerEntityCrud,
} from "@cosmicdrift/kumiko-framework/engine";

type LocalizedString = { readonly de: string; readonly en: string };

// Server-Pendant zu web.ts — der Boot-Validator liest required-i18n-Keys nur
// aus feature.translations (nicht aus dem Client-Bundle). Werte identisch zu
// den client-seitigen Labels, damit i18n-Keys serverseitig konsistent
// registriert sind (SSR-Fallback + Boot-Check).
const DEMO_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:item-edit.title": { de: "Element bearbeiten", en: "Edit item" },
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

export const demoEntity = createEntity({
  table: "read_styleguide_items",
  fields: {
    name: createTextField({ required: true, searchable: true, sortable: true }),
    description: createTextField({ multiline: { rows: 4 } }),
    quantity: createNumberField({ default: 1, sortable: true, filterable: true }),
    rating: createNumberField({ sortable: true }),
    isActive: createBooleanField({ default: true, sortable: true, filterable: true }),
    status: createSelectField({
      options: ["draft", "review", "published", "archived"] as const,
      default: "draft",
      sortable: true,
      filterable: true,
    }),
    publishedAt: createDateField({ sortable: true, filterable: true }),
    price: createMoneyField(),
  },
  defaultCurrency: "EUR",
});

const open = { access: { openToAll: true } } as const;

export const demoFeature = defineFeature("styleguide", (r) => {
  r.translations({ keys: DEMO_I18N });
  registerEntityCrud(r, "item", demoEntity, { write: open, read: open });

  r.screen({
    id: "item-edit",
    type: "entityEdit",
    entity: "item",
    layout: {
      sections: [
        {
          title: "Text",
          columns: 2,
          fields: [
            { field: "name", span: 2 },
            { field: "description", span: 2 },
          ],
        },
        {
          title: "Numbers & Flags",
          columns: 2,
          fields: ["quantity", "rating", "isActive", { field: "status", span: 2 }],
        },
        {
          title: "Dates & Money",
          columns: 2,
          fields: ["publishedAt", "price"],
        },
      ],
    },
  });

  r.screen({
    id: "item-list",
    type: "entityList",
    entity: "item",
    columns: ["name", "status", "isActive", "quantity", "publishedAt"],
    pagination: "pages",
    pageSize: 25,
    defaultSort: { field: "name", dir: "asc" },
    searchable: true,
    rowActions: [
      {
        kind: "navigate",
        id: "edit",
        label: "Edit",
        screen: "item-edit",
        rowClick: true,
      },
      {
        id: "delete",
        label: "Delete",
        handler: "styleguide:write:item:delete",
        confirm: "Delete this item?",
        style: "danger",
      },
    ],
  });

  r.nav({ id: "items", label: "Items", order: 10 });
  r.nav({
    id: "catalog",
    label: "Catalog",
    parent: "styleguide:nav:items",
    icon: "folder",
    order: 10,
  });
  r.nav({
    id: "item-list",
    label: "All items",
    parent: "styleguide:nav:catalog",
    screen: "styleguide:screen:item-list",
    icon: "list",
    order: 10,
  });
  r.nav({
    id: "item-new",
    label: "New item",
    parent: "styleguide:nav:catalog",
    screen: "styleguide:screen:item-edit",
    icon: "file",
    order: 20,
  });
});
