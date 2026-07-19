import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { editScreen, listScreen, taskEntity } from "./schema";

export { taskEntity };

const open = { access: { openToAll: true } } as const;

// r.translations() wants key-first shape — same screen titles already in
// ./i18n's client (locale-first) bundle.
const REQUIRED_I18N = {
  "screen:task-list.title": { de: "Aufgaben", en: "Tasks" },
  "screen:task-edit.title": { de: "Aufgabe", en: "Task" },
} as const;

export const taskFeature = defineFeature("tasks", (r) => {
  r.translations({ keys: REQUIRED_I18N });

  r.crud("task", taskEntity, { write: open, read: open });
  r.screen(editScreen);
  r.screen(listScreen);
  r.nav({ id: "task-list", label: "tasks.nav.list", screen: "tasks:screen:task-list", order: 10 });
  r.nav({ id: "task-new", label: "tasks.nav.new", screen: "tasks:screen:task-edit", order: 20 });
});
