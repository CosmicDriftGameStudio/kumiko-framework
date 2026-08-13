// Demo tasks feature — scaffolded by `kumiko new app`. Edit or replace.
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
  "tasks:nav.tasks": { de: "Aufgaben", en: "Tasks" },
  "tasks:nav.taskNew": { de: "Neue Aufgabe", en: "New task" },
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
  r.nav({ id: "tasks", label: "tasks:nav.tasks", order: 10, screen: "tasks:screen:task-list" });
  r.nav({
    id: "task-new",
    label: "tasks:nav.taskNew",
    parent: "tasks:nav:tasks",
    screen: "tasks:screen:task-edit",
    order: 10,
  });
});
