// Entity + Screen-Definitionen, server-side über feature.ts registriert.
// Browser bekommt sie via window.__KUMIKO_SCHEMA__-Injection durch den
// dev-server (buildAppSchema) — kein hand-geschriebener clientSchema-
// Mirror mehr.

import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";

// Entity — cast at the boundary. `createEntity` from framework/engine
// would read nicer here, but its import path pulls the full framework
// runtime; das wäre ein späteres Cleanup.
export const taskEntity = {
  table: "read_ui_walkthrough_tasks",

  fields: {
    title: { type: "text", required: true, sortable: true },
    status: { type: "text", sortable: true },
    priority: { type: "number" },
    isUrgent: { type: "boolean", default: false },
    notes: { type: "text" },
  },
} as unknown as EntityDefinition;

// Screens carry SHORT ids — die Registry qualifiziert sie zu
// `${featureName}:screen:${id}` beim r.screen()-Ingest.
export const editScreen: EntityEditScreenDefinition = {
  id: "task-edit",
  type: "entityEdit",
  entity: "task",
  layout: {
    sections: [
      {
        title: "Task basics",
        columns: 2,
        fields: [
          { field: "title", span: 2 },
          "status",
          "priority",
          "isUrgent",
          {
            field: "notes",
            span: 2,
            visible: { field: "isUrgent", eq: true },
            required: { field: "isUrgent", eq: true },
          },
        ],
      },
    ],
  },
};

export const listScreen: EntityListScreenDefinition = {
  id: "task-list",
  type: "entityList",
  entity: "task",
  columns: [
    "title",
    "status",
    "isUrgent",
    {
      field: "priority",
      renderer: { format: "priority", prefix: "P" },
    },
  ],
  defaultSort: { field: "title", dir: "asc" },
  rowActions: [{ kind: "navigate", id: "edit", label: "tasks:actions.edit", screen: "task-edit" }],
};
