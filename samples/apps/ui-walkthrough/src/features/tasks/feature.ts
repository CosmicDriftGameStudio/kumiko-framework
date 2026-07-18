import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { editScreen, listScreen, taskEntity } from "./schema";

export { taskEntity };

const open = { access: { openToAll: true } } as const;

export const taskFeature = defineFeature("tasks", (r) => {
  r.crud("task", taskEntity, { write: open, read: open });
  r.screen(editScreen);
  r.screen(listScreen);
  r.nav({ id: "task-list", label: "tasks.nav.list", screen: "tasks:screen:task-list", order: 10 });
  r.nav({ id: "task-new", label: "tasks.nav.new", screen: "tasks:screen:task-edit", order: 20 });
});
