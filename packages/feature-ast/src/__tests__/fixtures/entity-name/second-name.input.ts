import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const taskEntity = createEntity({
  fields: {},
});

export const feature = defineFeature("tasks", (r) => {
  r.entity({ name: "task", ...taskEntity });
  r.entity({ name: "archivedTask", ...taskEntity });
});
