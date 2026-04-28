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
} from "@kumiko/framework/ui-types";

export const itemEntity = {
  fields: {
    title: { type: "text", required: true, sortable: true, searchable: true },
    notes: { type: "text", multiline: { rows: 4 } },
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
          // Single + Remote — Bug-Test-Surface 1: Click auf Dropdown-Item
          // muss onChange feuern (selektiert das Item, schließt das Popup).
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
    // Tier 2.7e-4 Demo — Reference-Spalte. Renderer macht Bulk-Lookup
    // auf item:list (limit:200), zeigt parentId als parent.title.
    "parentId",
  ],
  // Server-side Pagination Demo — Showcase seedet ~200 items, der
  // Pager hat 4 Seiten zum Durchklicken bei pageSize: 50.
  pagination: "pages",
  pageSize: 50,
  defaultSort: { field: "title", dir: "asc" },
  searchable: true,
  // RowActions-Demo. Default-Payload ist `{ id: row.id }` — reicht für
  // delete. Confirm-Dialog wegen style="danger" automatisch.
  // Tier 2.7e-1 zeigt "navigate"-kind: ein zweiter Action-Button der
  // statt Server-Call zu einem actionForm springt + die row.id als
  // URL-Param übergibt (das actionForm liest sie via searchParams als
  // initial value für ein title-Feld).
  rowActions: [
    {
      kind: "navigate",
      id: "duplicate",
      label: "showcase:actions.duplicate",
      screen: "item-quick-add",
      params: (row) => ({ title: `Copy of ${row["title"]}`, priority: row["priority"] }),
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
      renderer: (v: unknown) => (v === undefined || v === 0 ? "—" : `P${v}`),
    },
    "dueDate",
  ],
  pagination: "infinite",
  pageSize: 30, // kleinere Pages damit Scroll-Effekt häufiger triggert
  defaultSort: { field: "title", dir: "asc" },
  searchable: true,
};

// Tier 2.7c Demo — Screen-Level Filter. Selbe Entity, gleicher Query-
// Handler wie itemListScreen, aber mit fixem WHERE: nur Items mit
// status="active". Klassisches Bucketing-Pattern (z.B. "Active Tasks"
// vs "All Tasks") ohne Custom-Page schreiben zu müssen.
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
};

// Tier 2.7d Demo — actionForm Screen-Typ. Non-CRUD Write-Handler-
// driven Form, hier mit dem existing item:create-Handler aber
// reduzierter Field-Auswahl (nur title + priority). Demonstriert dass
// eine actionForm:
//   - keine Entity-Reference braucht (fields sind inline)
//   - einen beliebigen Write-Handler-QN triggert (hier item:create,
//     üblich wäre auch sowas wie item:archive-batch oder
//     invoice:approve mit dedizierten Handlern)
//   - nach Submit redirecten kann (hier zur Liste)
//
// Default-Werte greifen für nicht-Form-Felder: status=draft, isDone=
// false, priority kommt aus dem Form, notes/dueDate optional.
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
