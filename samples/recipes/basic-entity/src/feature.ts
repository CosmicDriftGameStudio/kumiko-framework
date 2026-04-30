// Basic Entity Sample
// Shows: how to wire one event-sourced aggregate end-to-end. The framework
// gives you `defineEntityWriteHandler` / `defineEntityQueryHandler` so
// you don't hand-write Zod schemas for the standard verbs — but you still
// register one handler per verb explicitly. Pick what you need; leave out
// what you don't.

import {
  createBooleanField,
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityRestoreHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "@kumiko/framework/engine";

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
  r.entity("task", taskEntity);

  // Writes append CRUD-style events onto the task stream and update the
  // projection row in the same TX (the executor inside the helper takes care
  // of both). Custom logic? Replace any single line with an explicit
  // r.writeHandler.
  r.writeHandler(defineEntityCreateHandler("task", taskEntity, editorWrite));
  r.writeHandler(defineEntityUpdateHandler("task", taskEntity, editorWrite));
  r.writeHandler(defineEntityDeleteHandler("task", taskEntity, adminWrite));
  r.writeHandler(defineEntityRestoreHandler("task", taskEntity, adminWrite));

  // Reads served from the projection table.
  r.queryHandler(defineEntityListHandler("task", taskEntity, openRead));
  r.queryHandler(defineEntityDetailHandler("task", taskEntity, openRead));
});
