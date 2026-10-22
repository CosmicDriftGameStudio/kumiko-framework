// Minimales AppSchema fürs renderer/e2e — eine Entity, ein
// entityList + entityEdit Screen. Reicht um Form-Render, Submit-Flow,
// List-Render zu beweisen ohne Auth/Tenant/Multi-Feature-Komplexität.
//
// Kein Server-Bootstrap: das Schema wird im Browser direkt an
// createKumikoApp gehängt (keine window.__KUMIKO_SCHEMA__-Injection).

import type {
  ActionFormScreenDefinition,
  CustomScreenDefinition,
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { AppSchema } from "@cosmicdrift/kumiko-renderer/web";
import { dashboardScreen } from "./dashboard-fixture";

export const thingEntity = {
  fields: {
    label: { type: "text", required: true, sortable: true },
    isDone: { type: "boolean", default: false },
    notes: { type: "text" },
    status: { type: "select", options: ["draft", "active", "done"], default: "draft" },
  },
} as unknown as EntityDefinition;

export const thingListScreen: EntityListScreenDefinition = {
  id: "thing-list",
  type: "entityList",
  entity: "thing",
  columns: ["label", "isDone", "status"],
};

export const thingEditScreen: EntityEditScreenDefinition = {
  id: "thing-edit",
  type: "entityEdit",
  entity: "thing",
  writeExcludedFields: { create: ["notes"], update: ["notes"] },
  layout: {
    sections: [
      {
        title: "Thing",
        columns: 2,
        fields: [{ field: "label", span: 2 }, "isDone", "status", { field: "notes", span: 2 }],
      },
    ],
  },
};

export const taskEntity = {
  fields: {
    title: { type: "text", required: true, sortable: true },
    owner: { type: "text", sortable: true },
    priority: {
      type: "select",
      options: ["low", "medium", "high"],
      default: "medium",
      filterable: true,
    },
    estimate: { type: "number", sortable: true },
    notes: { type: "text" },
    location: { type: "text" },
    archived: { type: "boolean", default: false },
  },
} as unknown as EntityDefinition;

export const taskListScreen: EntityListScreenDefinition = {
  id: "task-list",
  type: "entityList",
  entity: "task",
  columns: ["title", "owner", "priority", "estimate"],
  searchable: true,
  defaultSort: { field: "title", dir: "asc" },
  table: {
    rememberState: true,
    resetAll: true,
    columnPicker: true,
    density: { default: "comfortable", userChoice: true },
    export: { xlsx: true },
  },
  rowActions: [
    { kind: "navigate", id: "open", label: "Open", screen: "task-edit", rowClick: true },
  ],
};

export const taskWideListScreen: EntityListScreenDefinition = {
  id: "task-wide-list",
  type: "entityList",
  entity: "task",
  columns: ["title", "owner", "priority", "estimate", "notes", "location"],
  rowActions: [
    { kind: "navigate", id: "open", label: "Open", screen: "task-edit", rowClick: true },
    { kind: "navigate", id: "edit", label: "Edit", screen: "task-edit" },
  ],
};

export const taskBoardScreen: EntityListScreenDefinition = {
  id: "task-board",
  type: "entityList",
  entity: "task",
  columns: [
    { field: "title", pinned: "left", width: 220 },
    { field: "owner", width: 160 },
    { field: "priority", width: 160 },
    { field: "estimate", width: 140 },
    { field: "notes", width: 420 },
    { field: "location", width: 420 },
  ],
  table: { rememberState: true, pinning: true, resizing: true, keyboardNavigation: true },
  rowActions: [
    { kind: "navigate", id: "open", label: "Open", screen: "task-edit", rowClick: true },
    { kind: "navigate", id: "edit", label: "Edit", screen: "task-edit" },
  ],
};

export const taskBoardPlainScreen: EntityListScreenDefinition = {
  id: "task-board-plain",
  type: "entityList",
  entity: "task",
  columns: [
    { field: "title", width: 220 },
    { field: "owner", width: 160 },
    { field: "priority", width: 160 },
    { field: "location", width: 300 },
  ],
  table: { columnPicker: true, resizing: true },
  rowActions: [
    { kind: "navigate", id: "open", label: "Open", screen: "task-edit", rowClick: true },
  ],
};

export const ARCHIVE_TASK_HANDLER = "test:write:task:archive";

export const taskBulkScreen: EntityListScreenDefinition = {
  id: "task-bulk",
  type: "entityList",
  entity: "task",
  columns: ["title", "owner", "archived"],
  table: { keyboardNavigation: true },
  rowActions: [
    { kind: "navigate", id: "open", label: "Open", screen: "task-edit", rowClick: true },
    {
      id: "archive",
      label: "Archive",
      handler: ARCHIVE_TASK_HANDLER,
      icon: "archive",
      visible: { field: "archived", ne: true },
    },
  ],
  bulkActions: [{ id: "archive", rowAction: "archive" }],
};

export const taskEditScreen: EntityEditScreenDefinition = {
  id: "task-edit",
  type: "entityEdit",
  entity: "task",
  listScreenId: "task-list",
  layout: {
    sections: [
      { title: "Task", columns: 2, fields: [{ field: "title", span: 2 }, "owner", "priority"] },
    ],
  },
};

export const FAILING_WRITE_HANDLER = "test:write:thing:fail";

const explodeAction = {
  id: "explode",
  label: "Explode",
  handler: FAILING_WRITE_HANDLER,
  display: "button",
} as const;

export const failingListScreen: EntityListScreenDefinition = {
  id: "thing-list-failing",
  type: "entityList",
  entity: "thing",
  columns: ["label", "status"],
  rowActions: [explodeAction],
  rowActionMode: "inline",
};

export const failingEditScreen: EntityEditScreenDefinition = {
  ...thingEditScreen,
  id: "thing-edit-failing",
  actions: [explodeAction],
};

export const ROLE_AVAILABILITY_QUERY = "test:query:role-availability";

const ROLE_OPTIONS = ["User", "Member", "Editor", "Admin", "TenantAdmin"] as const;

function rolesFormScreen(
  id: string,
  optionsAvailabilityQuery?: string,
): ActionFormScreenDefinition {
  return {
    id,
    type: "actionForm",
    handler: "test:write:thing:set-roles",
    fields: {
      roles: {
        type: "multiSelect",
        options: ROLE_OPTIONS,
        ...(optionsAvailabilityQuery !== undefined && { optionsAvailabilityQuery }),
      },
    },
    layout: { sections: [{ title: "Roles", fields: ["roles"] }] },
  };
}

export const rolesPlainScreen = rolesFormScreen("roles-plain");
export const rolesAvailabilityScreen = rolesFormScreen(
  "roles-availability",
  ROLE_AVAILABILITY_QUERY,
);

export const BOOM_SCREEN_ID = "boom";

export const boomScreen: CustomScreenDefinition = {
  id: BOOM_SCREEN_ID,
  type: "custom",
  renderer: { react: { __component: "Boom" } },
};

export const e2eSchema: AppSchema = {
  features: [
    {
      featureName: "test",
      translations: {
        "screen:debt-dashboard.title": { en: "Debts", de: "Schulden" },
        "screen:boom.title": { en: "Broken screen", de: "Kaputter Screen" },
        "test:entity:task:field:title": { en: "Title", de: "Titel" },
        "test:entity:task:field:owner": { en: "Owner", de: "Zuständig" },
        "test:entity:task:field:priority": { en: "Priority", de: "Priorität" },
        "test:entity:task:field:estimate": { en: "Estimate", de: "Aufwand" },
        "test:entity:task:field:archived": { en: "Archived", de: "Archiviert" },
      },
      entities: { thing: thingEntity, task: taskEntity },
      screens: [
        thingEditScreen,
        thingListScreen,
        rolesPlainScreen,
        rolesAvailabilityScreen,
        dashboardScreen,
        boomScreen,
        failingListScreen,
        failingEditScreen,
        taskListScreen,
        taskWideListScreen,
        taskBoardScreen,
        taskBoardPlainScreen,
        taskBulkScreen,
        taskEditScreen,
      ],
      navs: [
        { id: "thing-list", label: "Things", screen: "thing-list", order: 10 },
        { id: "thing-new", label: "New Thing", screen: "thing-edit", order: 20 },
        { id: "roles-plain", label: "Roles plain", screen: "roles-plain", order: 30 },
        {
          id: "roles-availability",
          label: "Roles availability",
          screen: "roles-availability",
          order: 40,
        },
        { id: "task-list", label: "Tasks", screen: "task-list", order: 50 },
        { id: "task-wide-list", label: "Overflow list", screen: "task-wide-list", order: 60 },
        { id: "task-board", label: "Layout board", screen: "task-board", order: 70 },
        {
          id: "task-board-plain",
          label: "Layout board without memory",
          screen: "task-board-plain",
          order: 80,
        },
        { id: "task-bulk", label: "Bulk actions", screen: "task-bulk", order: 90 },
      ],
    },
  ],
};
