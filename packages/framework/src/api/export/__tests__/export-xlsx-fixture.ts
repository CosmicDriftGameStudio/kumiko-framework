import * as z from "zod";
import { defineFeature } from "../../../engine/define-feature.ts";
import {
  createBooleanField,
  createDateField,
  createEntity,
  createMoneyField,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
} from "../../../engine/factories.ts";

export const customerEntity = createEntity({
  table: "xl_customers",
  fields: {
    name: createTextField({ personal: false, reason: "test_fixture" }),
  },
});

export const itemEntity = createEntity({
  table: "xl_items",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", searchable: true }),
    qty: createNumberField(),
    amount: createMoneyField(),
    dueOn: createDateField(),
    placedAt: createTimestampField(),
    status: createSelectField({ options: ["open", "paid"] as const }),
    active: createBooleanField(),
    vaultKey: createTextField({ personal: false, reason: "test_fixture", sensitive: true }),
    customer: { type: "reference", entity: "customer", labelField: "name" },
    contacts: { type: "reference", entity: "customer", labelField: "name", multiple: true },
    adminNote: createTextField({
      personal: false,
      reason: "test_fixture",
      access: { read: { Admin: "all" } },
    }),
  },
});

const COLUMNS = [
  "title",
  "qty",
  "amount",
  "dueOn",
  "placedAt",
  "status",
  "active",
  "vaultKey",
  "adminNote",
  "customer",
  "contacts",
] as const;

const OPEN_TO_ALL = { openToAll: { reason: "test handler callable by any signed-in test user" } };

export const exportFeature = defineFeature("xl", (r) => {
  r.entity({ name: "customer", ...customerEntity });
  r.crud("customer", customerEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: OPEN_TO_ALL },
  });
  r.entity({ name: "item", ...itemEntity });
  r.crud("item", itemEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: OPEN_TO_ALL },
  });
  r.queryHandler({
    name: "item:rows",
    schema: z.object({
      limit: z.number().optional(),
      offset: z.number().optional(),
      search: z.string().optional(),
    }),
    access: OPEN_TO_ALL,
    outputSchema: z.object({
      rows: z.array(z.object({ id: z.string(), label: z.string(), score: z.number() })),
      nextCursor: z.string().nullable(),
    }),
    handler: async ({ payload }) => {
      const all = ["alpha", "beta", "gamma"].map((label, i) => ({
        id: `row-${i}`,
        label,
        score: i + 1,
      }));
      const offset = payload.offset ?? 0;
      return { rows: all.slice(offset, offset + (payload.limit ?? 200)), nextCursor: null };
    },
  });
  r.translations({
    keys: {
      "entity:item:field:title": { en: "Title", de: "Titel" },
      "entity:item:field:qty": { en: "Quantity", de: "Menge" },
      "entity:item:field:amount": { en: "Amount", de: "Betrag" },
      "entity:item:field:dueOn": { en: "Due on", de: "Fällig am" },
      "entity:item:field:placedAt": { en: "Placed at", de: "Aufgegeben am" },
      "entity:item:field:status": { en: "Status", de: "Status" },
      "entity:item:field:active": { en: "Active", de: "Aktiv" },
      "entity:item:field:vaultKey": { en: "Vault key", de: "Tresor" },
      "entity:item:field:adminNote": { en: "Admin note", de: "Admin-Notiz" },
      "entity:item:field:customer": { en: "Customer", de: "Kunde" },
      "entity:item:field:contacts": { en: "Contacts", de: "Kontakte" },
      "entity:item:field:status:option:open": { en: "Open", de: "Offen" },
      "entity:item:field:status:option:paid": { en: "Paid", de: "Bezahlt" },
    },
  });
  r.screen({
    id: "item-list",
    type: "entityList",
    entity: "item",
    columns: [...COLUMNS],
    table: { export: { xlsx: true, maxRows: 5 } },
  });
  r.screen({
    id: "item-open",
    type: "entityList",
    entity: "item",
    columns: [...COLUMNS],
    filter: { field: "status", op: "eq", value: "open" },
    table: { export: { xlsx: true } },
  });
  r.screen({ id: "item-plain", type: "entityList", entity: "item", columns: [...COLUMNS] });
  r.screen({
    id: "item-admin",
    type: "entityList",
    entity: "item",
    columns: [...COLUMNS],
    access: { roles: ["Admin"] },
    table: { export: { xlsx: true } },
  });
  r.screen({
    id: "item-rows",
    type: "projectionList",
    query: "xl:query:item:rows",
    columns: ["label", { field: "score", valueType: "number" }],
    table: { export: { xlsx: true } },
  });
});

export const LIST_SCREEN = "xl:screen:item-list";
export const OPEN_SCREEN = "xl:screen:item-open";
export const PLAIN_SCREEN = "xl:screen:item-plain";
export const ADMIN_SCREEN = "xl:screen:item-admin";
export const ROWS_SCREEN = "xl:screen:item-rows";
export const CREATE_ITEM = "xl:write:item:create";
export const CREATE_CUSTOMER = "xl:write:customer:create";
