import {
  createBooleanField,
  createDateField,
  createEntity,
  createEntityExecutor,
  createMoneyField,
  createNumberField,
  createSelectField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";

import { DEMO_I18N } from "./i18n";

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
  r.crud("item", demoEntity, { write: open, read: open });

  // r.crud only auto-registers create/update/delete — these three status
  // transitions back the icon-only rowActions on item-list (>2 icon actions
  // triggers shouldRenderActionsIconOnly) and need their own write handlers.
  const { executor: itemExecutor } = createEntityExecutor("item", demoEntity);

  r.writeHandler(
    "item:archive",
    z.object({ id: z.uuid() }),
    async (event, ctx) =>
      // Admin-style status flip from a list row: last-writer-wins is fine,
      // same as the tenant enable/disable toggle this mirrors.
      itemExecutor.update(
        { id: event.payload.id, changes: { status: "archived" } },
        event.user,
        ctx.db,
        { skipOptimisticLock: true },
      ),
    { access: open.access },
  );

  r.writeHandler(
    "item:publish",
    z.object({ id: z.uuid() }),
    async (event, ctx) =>
      itemExecutor.update(
        {
          id: event.payload.id,
          changes: { status: "published", publishedAt: ctx.tz.today(ctx.tz.tenant).toString() },
        },
        event.user,
        ctx.db,
        { skipOptimisticLock: true },
      ),
    { access: open.access },
  );

  r.writeHandler(
    "item:duplicate",
    z.object({ id: z.uuid() }),
    async (event, ctx) => {
      const source = await itemExecutor.detail({ id: event.payload.id }, event.user, ctx.db);
      if (!source) return failNotFound("item", event.payload.id);
      return itemExecutor.create(
        {
          name: `${source["name"] as string} (Copy)`,
          description: source["description"],
          quantity: source["quantity"],
          rating: source["rating"],
          isActive: source["isActive"],
          status: source["status"],
          publishedAt: source["publishedAt"],
          price: source["price"],
        },
        event.user,
        ctx.db,
      );
    },
    { access: open.access },
  );

  r.screen({
    id: "item-edit",
    type: "entityEdit",
    entity: "item",
    layout: {
      sections: [
        {
          title: "Text",
          icon: "file",
          columns: 2,
          fields: [
            { field: "name", span: 2 },
            { field: "description", span: 2 },
          ],
        },
        {
          title: "Numbers & Flags",
          icon: "hash",
          columns: 2,
          fields: ["quantity", "rating", "isActive", { field: "status", span: 2 }],
        },
        {
          title: "Dates & Money",
          icon: "calendar",
          columns: 2,
          fields: ["publishedAt", "price"],
        },
      ],
    },
    // Same three status-transition handlers as item-list's rowActions,
    // now as header actions on the edit screen — three actions trigger
    // shouldRenderActionsIconOnly's icon-only collapse, same threshold
    // as the list's rowActions.
    actions: [
      {
        id: "publish",
        label: "Publish",
        handler: "styleguide:write:item:publish",
      },
      {
        id: "archive",
        label: "Archive",
        handler: "styleguide:write:item:archive",
        confirm: "Archive this item?",
      },
      {
        id: "duplicate",
        label: "Duplicate",
        handler: "styleguide:write:item:duplicate",
      },
    ],
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
        id: "publish",
        label: "Publish",
        handler: "styleguide:write:item:publish",
      },
      {
        id: "archive",
        label: "Archive",
        handler: "styleguide:write:item:archive",
        confirm: "Archive this item?",
      },
      {
        id: "duplicate",
        label: "Duplicate",
        handler: "styleguide:write:item:duplicate",
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

  // All 8 fields as columns so the table overflows its container even at
  // desktop widths (item-list's 5 narrow columns never do) — needed to
  // prove the sticky actions column stays pinned to the right edge on
  // scroll at md+ (table-overflow-mobile.spec.ts). Not in nav: reached
  // directly by URL from the e2e test.
  r.screen({
    id: "item-list-wide",
    type: "entityList",
    entity: "item",
    columns: [
      "name",
      "description",
      "status",
      "isActive",
      "quantity",
      "rating",
      "publishedAt",
      "price",
    ],
    pagination: "pages",
    pageSize: 25,
    defaultSort: { field: "name", dir: "asc" },
    rowActions: [
      {
        kind: "navigate",
        id: "edit",
        label: "Edit",
        screen: "item-edit",
        rowClick: true,
      },
    ],
  });

  r.nav({ id: "items", label: "styleguide:nav.items", icon: "layers", order: 10 });
  r.nav({
    id: "catalog",
    label: "styleguide:nav.catalog",
    parent: "styleguide:nav:items",
    icon: "folder",
    order: 10,
  });
  r.nav({
    id: "item-list",
    label: "styleguide:nav.itemList",
    parent: "styleguide:nav:catalog",
    screen: "styleguide:screen:item-list",
    icon: "list",
    order: 10,
  });
  r.nav({
    id: "item-new",
    label: "styleguide:nav.itemNew",
    parent: "styleguide:nav:catalog",
    screen: "styleguide:screen:item-edit",
    icon: "file",
    order: 20,
  });
});
