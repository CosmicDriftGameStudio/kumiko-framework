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
  ActionFormScreenDefinition,
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";

export const itemEntity = {
  description:
    "A showcase task item carrying a title, free-text notes, a numeric priority, a done flag, a due date and a draft/active/blocked/done status, plus an optional parent item and a list of related items.",
  fields: {
    title: {
      type: "text",
      required: true,
      sortable: true,
      searchable: true,
      allowPlaintext: "is_business_data",
    },
    notes: { type: "text", multiline: { rows: 4 }, allowPlaintext: "is_business_data" },
    priority: { type: "number", default: 1, sortable: true, filterable: true },
    isDone: { type: "boolean", default: false, sortable: true, filterable: true },
    dueDate: { type: "date", sortable: true, filterable: true },
    status: {
      type: "select",
      options: ["draft", "active", "blocked", "done"],
      default: "draft",
      sortable: true,
      filterable: true,
    },
    // Tier 2.7e-3 Demo — Self-Reference: jedes Item kann optional ein
    // anderes Item als "parent task" referenzieren. Renderer zeigt im
    // Edit-Form ein Combobox-Dropdown mit Search (Tier 2.1c), List-
    // Spalte resolvet die UUID via Bulk-Lookup zum title.
    parentId: { type: "reference", entity: "item", labelField: "title" },
    // Tier 2.7e-Multi Demo — Multi-Reference: ein Item kann mehrere
    // verwandte Items haben. Storage als jsonb-Array<uuid>. UI rendert
    // Multi-Combobox mit Tag-Anzeige.
    relatedIds: {
      type: "reference",
      entity: "item",
      labelField: "title",
      multiple: true,
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
        title: "References (Tier 2.7e Remote-Combobox-Demo)",
        columns: 1,
        fields: [
          // Single + remote — bug test surface 1: click on a dropdown item
          // must fire onChange (selects the item, closes the popup).
          "parentId",
          // Multi + Remote — Bug-Test-Surface 2: Tippen filtert die Liste
          // serverseitig. Mit ~200 seed-Items echte Search-Last.
          "relatedIds",
        ],
      },
      {
        title: "Details",
        columns: 1,
        fields: [
          {
            field: "notes",
            visible: { field: "isDone", eq: true },
            required: { field: "isDone", eq: true },
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
      renderer: { format: "priority", prefix: "P" },
    },
    "dueDate",
    // Tier 2.7e-4 Demo — Reference-Spalte. Renderer macht Bulk-Lookup
    // auf item:list (limit:200), zeigt parentId als parent.title.
    { field: "parentId", hideOnNarrow: true },
  ],
  // Server-side pagination demo — the showcase seeds ~200 items, the
  // pager has 4 pages to click through at pageSize: 50.
  pagination: "pages",
  pageSize: 50,
  defaultSort: { field: "title", dir: "asc" },
  searchable: true,
  // RowActions demo. The default payload is `{ id: row.id }` — enough for
  // delete. Confirm dialog automatically because of style="danger".
  // Tier 2.7e-1 shows the "navigate" kind: a second action button that
  // jumps to an actionForm instead of making a server call + passes row.id as a
  // URL param (the actionForm reads it via searchParams as an
  // initial value for a title field).
  rowActions: [
    { kind: "navigate", id: "edit", label: "showcase:actions.edit", screen: "item-edit" },
    {
      kind: "navigate",
      id: "duplicate",
      label: "showcase:actions.duplicate",
      screen: "item-quick-add",
      // DSL limit: no "Copy of" prefix expressible → solve server-side in the handler.
      params: { pick: ["title", "priority"] },
    },
    {
      id: "delete",
      label: "showcase:actions.delete",
      handler: "showcase:write:item:delete",
      confirm: "showcase:actions.delete-confirm",
      style: "danger",
    },
  ],
};

// Zweiter Screen auf derselben Entity, aber im Infinite-Scroll-Modus.
// Demonstriert dass beide Pagination-Stile (Pager + Infinite) auf
// denselben Daten funktionieren — Author-Choice pro Screen.
export const itemFeedScreen: EntityListScreenDefinition = {
  id: "item-feed",
  type: "entityList",
  entity: "item",
  columns: [
    "title",
    "status",
    {
      field: "priority",
      renderer: { format: "priority", prefix: "P" },
    },
    "dueDate",
  ],
  pagination: "infinite",
  pageSize: 30, // smaller pages so the scroll effect triggers more often
  defaultSort: { field: "title", dir: "asc" },
  searchable: true,
  rowActions: [
    { kind: "navigate", id: "edit", label: "showcase:actions.edit", screen: "item-edit" },
  ],
};

// Tier 2.7c demo — screen-level filter. Same entity, same query
// handler as itemListScreen, but with a fixed WHERE: only items with
// status="active". Classic bucketing pattern (e.g. "Active Tasks"
// vs "All Tasks") without having to write a custom page.
export const itemActiveScreen: EntityListScreenDefinition = {
  id: "item-active",
  type: "entityList",
  entity: "item",
  columns: ["title", "status", "isDone", "dueDate"],
  pagination: "pages",
  pageSize: 50,
  defaultSort: { field: "title", dir: "asc" },
  searchable: true,
  filter: { field: "status", op: "eq", value: "active" },
  rowActions: [
    { kind: "navigate", id: "edit", label: "showcase:actions.edit", screen: "item-edit" },
  ],
};

// Tier 2.7d demo — actionForm screen type. A non-CRUD write-handler-
// driven form, here with the existing item:create handler but a
// reduced field selection (only title + priority). Demonstrates that
// an actionForm:
//   - needs no entity reference (fields are inline)
//   - triggers any write handler QN (here item:create,
//     something like item:archive-batch or
//     invoice:approve with dedicated handlers would be typical)
//   - can redirect after submit (here to the list)
//
// Default values apply for non-form fields: status=draft, isDone=
// false, priority comes from the form, notes/dueDate optional.
export const itemQuickAddScreen: ActionFormScreenDefinition = {
  id: "item-quick-add",
  type: "actionForm",
  handler: "showcase:write:item:create",
  fields: {
    title: { type: "text", required: true },
    priority: { type: "number", default: 1 },
  },
  layout: {
    sections: [
      {
        title: "Quick Add",
        columns: 2,
        fields: [{ field: "title", span: 2 }, "priority"],
      },
    ],
  },
  submitLabel: "showcase:actions.quick-add",
  redirect: "item-list",
};
