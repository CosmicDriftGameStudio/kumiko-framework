import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const taskEntity = createEntity({ fields: {} });

export const feature = defineFeature("tasks", (r) => {
  r.crud("task", taskEntity, { write: { access }, read: { access } });
  r.crud("archivedTask", taskEntity);
});

const { table, executor } = createEntityExecutor("task", taskEntity);
const archivedTable = buildEntityTable("task", taskEntity, { schema });
const meta = deriveEntityTableMeta("archivedTask", taskEntity, options);
