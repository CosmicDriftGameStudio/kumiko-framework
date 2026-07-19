#!/usr/bin/env bun
// Patch tasks i18n into hero-apps scaffolded from @cosmicdrift/*@0.133.0 (pre-fix).
// Usage: bun scripts/demos/patch-published-scaffold-tasks.ts [app-dir]

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const appDir = resolve(process.argv[2] ?? process.cwd());
const tasksDir = join(appDir, "src/features/tasks");

if (!existsSync(join(appDir, "package.json"))) {
  console.error(`[patch-tasks] no package.json in ${appDir}`);
  process.exit(1);
}

mkdirSync(join(tasksDir, "web"), { recursive: true });

writeFileSync(
  join(tasksDir, "i18n.ts"),
  `import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const tasksTranslationKeys = {
  "screen:task-list.title": { de: "Aufgaben", en: "Tasks" },
  "screen:task-edit.title": { de: "Aufgabe", en: "Task" },
  "tasks:entity:task:field:title": { de: "Titel", en: "Title" },
  "tasks:entity:task:field:status": { de: "Status", en: "Status" },
  "tasks:entity:task:field:priority": { de: "Priorität", en: "Priority" },
  "tasks:entity:task:field:isUrgent": { de: "Dringend", en: "Urgent" },
} as const;

export const tasksTranslations: TranslationsByLocale = {
  de: {
    "screen:task-list.title": "Aufgaben",
    "screen:task-edit.title": "Aufgabe",
    "tasks:entity:task:field:title": "Titel",
    "tasks:entity:task:field:status": "Status",
    "tasks:entity:task:field:priority": "Priorität",
    "tasks:entity:task:field:isUrgent": "Dringend",
  },
  en: {
    "screen:task-list.title": "Tasks",
    "screen:task-edit.title": "Task",
    "tasks:entity:task:field:title": "Title",
    "tasks:entity:task:field:status": "Status",
    "tasks:entity:task:field:priority": "Priority",
    "tasks:entity:task:field:isUrgent": "Urgent",
  },
};
`,
);

writeFileSync(
  join(tasksDir, "feature.ts"),
  `import {
  createBooleanField,
  createEntity,
  createNumberField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import type {
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { tasksTranslationKeys } from "./i18n";

const taskEntity = createEntity({
  fields: {
    title: createTextField({ required: true, sortable: true }),
    status: createTextField({ sortable: true }),
    priority: createNumberField(),
    isUrgent: createBooleanField({ default: false }),
  },
});

const listScreen: EntityListScreenDefinition = {
  id: "task-list",
  type: "entityList",
  entity: "task",
  columns: ["title", "status", "isUrgent", "priority"],
  defaultSort: { field: "title", dir: "asc" },
  rowActions: [{ kind: "navigate", id: "edit", label: "Edit", screen: "task-edit" }],
};

const editScreen: EntityEditScreenDefinition = {
  id: "task-edit",
  type: "entityEdit",
  entity: "task",
  layout: {
    sections: [{ title: "Task", fields: ["title", "status", "priority", "isUrgent"] }],
  },
};

const open = { access: { openToAll: true } } as const;

export const tasksFeature = defineFeature("tasks", (r) => {
  r.entity("task", taskEntity);
  r.writeHandler(defineEntityCreateHandler("task", taskEntity, open));
  r.writeHandler(defineEntityUpdateHandler("task", taskEntity, open));
  r.writeHandler(defineEntityDeleteHandler("task", taskEntity, open));
  r.queryHandler(defineEntityListHandler("task", taskEntity, open));
  r.queryHandler(defineEntityDetailHandler("task", taskEntity, open));
  r.screen(listScreen);
  r.screen(editScreen);
  r.translations({ keys: tasksTranslationKeys });
  r.nav({ id: "tasks", label: "Tasks", order: 10, screen: "tasks:screen:task-list" });
  r.nav({
    id: "task-new",
    label: "New task",
    parent: "tasks:nav:tasks",
    screen: "tasks:screen:task-edit",
    order: 10,
  });
});
`,
);

writeFileSync(
  join(tasksDir, "web/index.ts"),
  `import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { tasksTranslations } from "../i18n";

export const tasksClient: ClientFeatureDefinition = {
  name: "tasks",
  translations: tasksTranslations,
};
`,
);

const clientPath = join(appDir, "src/client.tsx");
if (existsSync(clientPath)) {
  let client = readFileSync(clientPath, "utf8");
  if (!client.includes("tasksClient")) {
    client = client.replace(
      'import { createKumikoApp, DefaultAppShell } from "@cosmicdrift/kumiko-renderer-web";',
      'import { tasksClient } from "./features/tasks/web";\nimport { createKumikoApp, DefaultAppShell } from "@cosmicdrift/kumiko-renderer-web";',
    );
    client = client.replace(
      "clientFeatures: [emailPasswordClient()],",
      "clientFeatures: [emailPasswordClient(), tasksClient],",
    );
    writeFileSync(clientPath, client);
  }
}

console.log(`[patch-tasks] patched ${appDir}`);


