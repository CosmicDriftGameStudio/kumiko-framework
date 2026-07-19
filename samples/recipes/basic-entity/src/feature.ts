// Basic Entity Sample
// Shows: how to wire one event-sourced aggregate end-to-end via r.crud.
// Custom logic or per-verb access? Skip a verb in `verbs` and register explicitly.

import {
  createBooleanField,
  createEntity,
  createTextField,
  defineEntityDeleteHandler,
  defineEntityRestoreHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

export const taskEntity = createEntity({
  table: "read_sample_tasks",
  fields: {
    title: createTextField({ required: true }),
    description: createTextField(),
    // sortable: true so the integration test can exercise list-with-sort.
    status: createTextField({ sortable: true }),
    isArchived: createBooleanField({ default: false }),
  },
  softDelete: true,
});

const editorWrite = { access: { roles: ["Admin", "User"] } } as const;
const adminWrite = { access: { roles: ["Admin"] } } as const;
const openRead = { access: { openToAll: true } } as const;

export const taskFeature = defineFeature("tasks", (r) => {
  r.crud("task", taskEntity, {
    write: editorWrite,
    read: openRead,
    verbs: { delete: false, restore: false },
  });
  r.writeHandler(defineEntityDeleteHandler("task", taskEntity, adminWrite));
  r.writeHandler(defineEntityRestoreHandler("task", taskEntity, adminWrite));
});
