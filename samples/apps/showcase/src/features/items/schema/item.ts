// Items-Feature — Schema (beidseitig importierbar). Entity-Fields plus
// Edit/List-Screen-Definitionen. KEIN Server-Code (keine Drizzle-,
// kein Handler-Import) — feature.ts (Server) UND client.ts (Client)
// importieren das hier.
//
// Kitchen-Sink: deckt alle Field-Types ab die DefaultInput rendert
// (text, number, boolean, date, select), plus Layout-Features
// (Section, columns, span, conditional visibility/required, custom
// column renderer).

import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@kumiko/framework/ui-types";

export const itemEntity = {
  fields: {
    title: { type: "text", required: true, sortable: true, searchable: true },
    notes: { type: "text", multiline: { rows: 4 } },
    priority: { type: "number", default: 1, sortable: true },
    isDone: { type: "boolean", default: false, sortable: true },
    dueDate: { type: "date" },
    status: {
      type: "select",
      options: ["draft", "active", "blocked", "done"],
      default: "draft",
      sortable: true,
    },
  },
} as unknown as EntityDefinition;

export const itemEditScreen: EntityEditScreenDefinition = {
  id: "item-edit",
  type: "entityEdit",
  entity: "item",
  layout: {
    sections: [
      {
        title: "Basics",
        columns: 2,
        fields: [{ field: "title", span: 2 }, "priority", "isDone", { field: "status", span: 2 }],
      },
      {
        title: "Details",
        columns: 1,
        fields: [
          {
            field: "notes",
            visible: (d) => (d as { isDone?: boolean }).isDone === true,
            required: (d) => (d as { isDone?: boolean }).isDone === true,
          },
          "dueDate",
        ],
      },
    ],
  },
};

export const itemListScreen: EntityListScreenDefinition = {
  id: "item-list",
  type: "entityList",
  entity: "item",
  columns: [
    "title",
    "status",
    "isDone",
    {
      field: "priority",
      renderer: (v: unknown) => (v === undefined || v === 0 ? "—" : `P${v}`),
    },
    "dueDate",
  ],
  // Server-side Pagination Demo — Showcase seedet ~200 items, der
  // Pager hat 4 Seiten zum Durchklicken bei pageSize: 50.
  pagination: "pages",
  pageSize: 50,
  defaultSort: { field: "title", dir: "asc" },
  searchable: true,
};
