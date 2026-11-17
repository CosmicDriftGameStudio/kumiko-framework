import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { taskEntity } from "./task-entity";

export const tasksFeature = defineFeature("tasks", (r) => {
  r.entity(taskEntity);
});
