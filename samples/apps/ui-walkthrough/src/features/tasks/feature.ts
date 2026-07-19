import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { tasksTranslations } from "./i18n";
import { editScreen, listScreen, taskEntity } from "./schema";

export { taskEntity };

const open = { access: { openToAll: true } } as const;

// r.translations() wants key-first shape ({key: {de, en}}); tasksTranslations
// is locale-first (client TranslationsByLocale shape) — invert here (bracket
// notation + fallback avoids TS4111/TS18048 under noUncheckedIndexedAccess).
const REQUIRED_I18N: Record<string, { de: string; en: string }> = Object.fromEntries(
  Object.keys(tasksTranslations["de"] ?? {}).map((key) => [
    key,
    { de: tasksTranslations["de"]?.[key] ?? "", en: tasksTranslations["en"]?.[key] ?? "" },
  ]),
);

export const taskFeature = defineFeature("tasks", (r) => {
  r.translations({ keys: REQUIRED_I18N });

  r.crud("task", taskEntity, { write: open, read: open });
  r.screen(editScreen);
  r.screen(listScreen);
  r.nav({ id: "task-list", label: "tasks.nav.list", screen: "tasks:screen:task-list", order: 10 });
  r.nav({ id: "task-new", label: "tasks.nav.new", screen: "tasks:screen:task-edit", order: 20 });
});
