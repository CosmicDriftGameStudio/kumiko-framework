import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const taskEntity = createEntity({
  fields: { title: { type: "text" } },
});
const noteEntity = createEntity({ fields: { body: { type: "text" } } });

export const feature = defineFeature("tasks", (r) => {
  r.entity({ name: "task", ...taskEntity });
  r.entity({ name: "note", ...noteEntity, backingTable: noteTable });
});
