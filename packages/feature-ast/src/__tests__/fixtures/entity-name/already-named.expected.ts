import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const FILE_REF = "file-ref";

const fileRefEntity = createEntity({ name: FILE_REF, fields: {} });
const taskEntity = createEntity({ name: "task", fields: {} });

export const feature = defineFeature("files", (r) => {
  r.entity(fileRefEntity);
  r.entity(taskEntity);
  r.entity({ ...taskEntity, name: "archivedTask" });
  r.entity({ ...taskEntity, webhookEvents: true });
  r.entity({ ...taskEntity, name: "mixed", table: "read_x" });
});

const table = buildEntityTable(taskEntity);
const archived = deriveEntityTableMeta({ ...taskEntity, name: "archived" }, options);
