import {
  createDateField,
  createDerivedField,
  createEntity,
  createMoneyField,
  createSelectField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

const openAccess = {
  access: {
    openToAll: { reason: "recipe: any signed-in user reads and edits; no per-user ownership" },
  },
} as const;

export const ticketEntity = createEntity({
  table: "read_derived_sql_tickets",
  fields: {
    buildingId: { type: "reference", entity: "building" },
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
    status: createSelectField({ options: ["open", "inProgress", "done"] as const }),
    openedOn: createDateField({ required: true }),
    cost: createMoneyField(),
  },
  // The sortable derived columns of the building run a subquery per row over this column.
  indexes: [{ columns: ["buildingId"] }],
});

export const buildingEntity = createEntity({
  table: "read_derived_sql_buildings",
  fields: {
    name: createTextField({
      personal: false,
      reason: "is_business_data",
      required: true,
      searchable: true,
    }),
    nickname: createTextField({ personal: false, reason: "is_business_data" }),
  },
  // Computed inside the list SELECT as the viewer; never stored, never cached.
  derivedFields: {
    // First non-null of the columns, so the list shows the nickname when there is one.
    shownName: createDerivedField({
      valueType: "text",
      sortable: true,
      sql: { kind: "coalesce", fields: ["nickname", "name"] },
    }),
    openTickets: createDerivedField({
      valueType: "number",
      sortable: true,
      sql: {
        kind: "related",
        entity: "ticket",
        on: { field: "buildingId" },
        measure: { kind: "count" },
        where: [{ field: "status", op: "in", value: ["open", "inProgress"] }],
      },
    }),
    latestTicket: createDerivedField({
      valueType: "text",
      sql: {
        kind: "related",
        entity: "ticket",
        on: { field: "buildingId" },
        measure: { kind: "first", field: "title", orderBy: "openedOn", direction: "desc" },
      },
    }),
    // Money reads amount and currency together and has the shape of a stored money field.
    latestCost: createDerivedField({
      valueType: "money",
      sortable: true,
      sql: {
        kind: "related",
        entity: "ticket",
        on: { field: "buildingId" },
        measure: { kind: "first", field: "cost", orderBy: "openedOn", direction: "desc" },
      },
    }),
  },
});

export const buildingListSort = { field: "openTickets", dir: "desc" } as const;

export const derivedFieldsSqlFeature = defineFeature("derived-fields-sql", (r) => {
  r.crud("ticket", ticketEntity, { write: openAccess, read: openAccess });
  r.crud("building", buildingEntity, { write: openAccess, read: openAccess });

  r.screen({
    id: "building-list",
    type: "entityList",
    entity: "building",
    columns: ["shownName", "openTickets", "latestTicket", "latestCost"],
    // A derived column sorts on the server only when it is `sortable: true`.
    defaultSort: buildingListSort,
    access: openAccess.access,
  });
});
