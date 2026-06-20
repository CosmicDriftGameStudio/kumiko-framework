// Styleguide-Demo-Feature (server). Eine Kitchen-Sink-Entity mit allen
// gängigen Feldtypen → die Auto-UI rendert daraus echte Edit-/List-Screens
// + Sidebar-Nav. Genau diese schema-getriebene Oberfläche wollen wir auf
// shadcn „new-york" polieren; der Screenshot-Runner schießt sie.

import {
  createBooleanField,
  createDateField,
  createEntity,
  createMoneyField,
  createNumberField,
  createSelectField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

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
  r.entity("item", demoEntity);

  r.writeHandler(defineEntityCreateHandler("item", demoEntity, open));
  r.writeHandler(defineEntityUpdateHandler("item", demoEntity, open));
  r.writeHandler(defineEntityDeleteHandler("item", demoEntity, open));
  r.queryHandler(defineEntityListHandler("item", demoEntity, open));
  r.queryHandler(defineEntityDetailHandler("item", demoEntity, open));

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
        id: "delete",
        label: "Delete",
        handler: "styleguide:write:item:delete",
        confirm: "Delete this item?",
        style: "danger",
      },
    ],
  });

  // Nav demonstriert das sidebar-07-Muster: statische Section "Items" >
  // collapsible Item "Catalog" (Icon, kein Screen) > Sub-Links.
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
