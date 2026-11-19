import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const taskEntity = createEntity({ name: "task", fields: {} });

export const feature = defineFeature("tasks", (r) => {
  r.crud(taskEntity, { write: { access }, read: { access } });
  r.crud({ ...taskEntity, name: "archivedTask" });
});

const { table, executor } = createEntityExecutor(taskEntity);
const archivedTable = buildEntityTable(taskEntity, { schema });
const meta = deriveEntityTableMeta({ ...taskEntity, name: "archivedTask" }, options);
