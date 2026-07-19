// Demo `tasks` feature + seed for scaffolded apps — wasp-like starter UX.
// `createDemoTasksFeature()` feeds init-migration generation; the render*
// functions emit the same shape into the user's repo.

import {
  createBooleanField,
  createEntity,
  createNumberField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import type {
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";

const taskEntity = createEntity({
  fields: {
    title: createTextField({ required: true, sortable: true }),
    status: createTextField({ sortable: true }),
    priority: createNumberField(),
    isUrgent: createBooleanField({ default: false }),
  },
});

const listScreen: EntityListScreenDefinition = {
  id: "task-list",
  type: "entityList",
  entity: "task",
  columns: ["title", "status", "isUrgent", "priority"],
  defaultSort: { field: "title", dir: "asc" },
  rowActions: [{ kind: "navigate", id: "edit", label: "Edit", screen: "task-edit" }],
};

const editScreen: EntityEditScreenDefinition = {
  id: "task-edit",
  type: "entityEdit",
  entity: "task",
  layout: {
    sections: [{ title: "Task", fields: ["title", "status", "priority", "isUrgent"] }],
  },
};

const open = { access: { openToAll: true } } as const;

const TASKS_I18N = {
  "screen:task-list.title": { de: "Aufgaben", en: "Tasks" },
  "screen:task-edit.title": { de: "Aufgabe", en: "Task" },
  "tasks:entity:task:field:title": { de: "Titel", en: "Title" },
  "tasks:entity:task:field:status": { de: "Status", en: "Status" },
  "tasks:entity:task:field:priority": { de: "Priorität", en: "Priority" },
  "tasks:entity:task:field:isUrgent": { de: "Dringend", en: "Urgent" },
} as const;

/** Canonical demo feature — keep in sync with `renderDemoTasksFeatureFile()`. */
export function createDemoTasksFeature(): FeatureDefinition {
  return defineFeature("tasks", (r) => {
    r.translations({ keys: TASKS_I18N });
    r.entity("task", taskEntity);
    r.writeHandler(defineEntityCreateHandler("task", taskEntity, open));
    r.writeHandler(defineEntityUpdateHandler("task", taskEntity, open));
    r.writeHandler(defineEntityDeleteHandler("task", taskEntity, open));
    r.queryHandler(defineEntityListHandler("task", taskEntity, open));
    r.queryHandler(defineEntityDetailHandler("task", taskEntity, open));
    r.screen(listScreen);
    r.screen(editScreen);
    r.nav({ id: "tasks", label: "Tasks", order: 10, screen: "tasks:screen:task-list" });
    r.nav({
      id: "task-new",
      label: "New task",
      parent: "tasks:nav:tasks",
      screen: "tasks:screen:task-edit",
      order: 10,
    });
  });
}

export function renderDemoTasksFeatureFile(): string {
  return `// Demo tasks feature — scaffolded by \`kumiko new app\`. Edit or replace.
// Entity + CRUD handlers + list/edit screens + sidebar nav.

import {
  createBooleanField,
  createEntity,
  createNumberField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import type {
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";

const taskEntity = createEntity({
  fields: {
    title: createTextField({ required: true, sortable: true }),
    status: createTextField({ sortable: true }),
    priority: createNumberField(),
    isUrgent: createBooleanField({ default: false }),
  },
});

const listScreen: EntityListScreenDefinition = {
  id: "task-list",
  type: "entityList",
  entity: "task",
  columns: ["title", "status", "isUrgent", "priority"],
  defaultSort: { field: "title", dir: "asc" },
  rowActions: [{ kind: "navigate", id: "edit", label: "Edit", screen: "task-edit" }],
};

const editScreen: EntityEditScreenDefinition = {
  id: "task-edit",
  type: "entityEdit",
  entity: "task",
  layout: {
    sections: [{ title: "Task", fields: ["title", "status", "priority", "isUrgent"] }],
  },
};

const open = { access: { openToAll: true } } as const;

const TASKS_I18N = {
  "screen:task-list.title": { de: "Aufgaben", en: "Tasks" },
  "screen:task-edit.title": { de: "Aufgabe", en: "Task" },
  "tasks:entity:task:field:title": { de: "Titel", en: "Title" },
  "tasks:entity:task:field:status": { de: "Status", en: "Status" },
  "tasks:entity:task:field:priority": { de: "Priorität", en: "Priority" },
  "tasks:entity:task:field:isUrgent": { de: "Dringend", en: "Urgent" },
} as const;

export const tasksFeature = defineFeature("tasks", (r) => {
  r.translations({ keys: TASKS_I18N });
  r.entity("task", taskEntity);
  r.writeHandler(defineEntityCreateHandler("task", taskEntity, open));
  r.writeHandler(defineEntityUpdateHandler("task", taskEntity, open));
  r.writeHandler(defineEntityDeleteHandler("task", taskEntity, open));
  r.queryHandler(defineEntityListHandler("task", taskEntity, open));
  r.queryHandler(defineEntityDetailHandler("task", taskEntity, open));
  r.screen(listScreen);
  r.screen(editScreen);
  r.nav({ id: "tasks", label: "Tasks", order: 10, screen: "tasks:screen:task-list" });
  r.nav({
    id: "task-new",
    label: "New task",
    parent: "tasks:nav:tasks",
    screen: "tasks:screen:task-edit",
    order: 10,
  });
});
`;
}

export function renderDemoTasksIndex(): string {
  return `export { tasksFeature } from "./feature";
`;
}

export function renderDemoSeedFile(): string {
  return `// Demo seed — a few tasks so \`bun dev\` shows a non-empty list.
// Idempotent: skips when the tenant already has tasks (persistent dev DB).

import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";

const DEMO_TASKS = [
  { title: "Welcome to Kumiko", status: "todo", priority: 1, isUrgent: false },
  { title: "Try editing me", status: "in progress", priority: 2, isUrgent: true },
] as const;

export const seedDemoTasks: SeedFn = async (stack) => {
  const admin = TestUsers.admin;
  const existing = await stack.http.queryOk<{ rows: unknown[] }>(
    "tasks:query:task:list",
    {},
    admin,
  );
  if (existing.rows.length > 0) return;
  for (const task of DEMO_TASKS) {
    await stack.http.write("tasks:write:task:create", task, admin);
  }
};
`;
}
