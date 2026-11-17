import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const taskEntity = createEntity({
  name: "task",
  fields: { title: { type: "text" } },
});
const noteEntity = createEntity({ name: "note", fields: { body: { type: "text" } } });

export const feature = defineFeature("tasks", (r) => {
  r.entity(taskEntity);
  r.entity({ ...noteEntity, backingTable: noteTable });
});
