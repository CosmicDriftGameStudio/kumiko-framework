import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const FILE_REF = "file-ref";

const fileRefEntity = createEntity({ name: FILE_REF, fields: {} });
const taskEntity = createEntity({ name: "task", fields: {} });

export const feature = defineFeature("files", (r) => {
  r.entity({ name: FILE_REF, ...fileRefEntity });
  r.entity({ name: "task", ...taskEntity });
  r.entity({ name: "archivedTask", ...taskEntity });
  r.entity({ name: "task", ...taskEntity, webhookEvents: true });
  r.entity({ name: "mixed", ...taskEntity, table: "read_x" });
});

const table = buildEntityTable("task", taskEntity);
const archived = deriveEntityTableMeta("archived", taskEntity, options);
