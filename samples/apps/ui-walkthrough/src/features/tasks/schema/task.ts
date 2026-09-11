// Entity + screen definitions, registered server-side through feature.ts.
// The browser receives them via the dev-server's window.__KUMIKO_SCHEMA__
// injection (buildAppSchema) — no hand-written clientSchema mirror.

import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";

// `status` stays inside the segmented-radio heuristic (at most 4 options),
// `area` deliberately falls out of it and renders as a combobox — the
// generated e2e spec exercises both select render paths.
const TASK_STATUSES = ["todo", "in progress", "done", "blocked"] as const;
const TASK_AREAS = [
  "engineering",
  "design",
  "marketing",
  "customer support",
  "operations",
  "finance",
] as const;

// Entity — cast at the boundary. `createEntity` from framework/engine
// would read nicer here, but its import path pulls the full framework
// runtime; that is a later cleanup.
export const taskEntity = {
  table: "read_ui_walkthrough_tasks",

  fields: {
    title: { type: "text", required: true, sortable: true },
    status: { type: "select", options: TASK_STATUSES, sortable: true },
    area: { type: "select", options: TASK_AREAS },
    priority: { type: "number" },
    isUrgent: { type: "boolean", default: false },
    notes: { type: "text" },
  },
} as unknown as EntityDefinition;

// Screens carry SHORT ids — the registry qualifies them to
// `${featureName}:screen:${id}` on r.screen() ingest.
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
          "area",
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
