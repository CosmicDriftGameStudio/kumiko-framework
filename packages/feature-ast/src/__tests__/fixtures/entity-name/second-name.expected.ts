import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const taskEntity = createEntity({
  name: "task",
  fields: {},
});

export const feature = defineFeature("tasks", (r) => {
  r.entity(taskEntity);
  r.entity({ ...taskEntity, name: "archivedTask" });
});
