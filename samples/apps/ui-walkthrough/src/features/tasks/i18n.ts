// Tasks-Feature i18n-Bundle. Plattform-neutral — Web und (zukünftig)
// Native konsumieren das gleiche Bundle.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const tasksTranslations: TranslationsByLocale = {
  de: {
    "tasks.nav.list": "Aufgaben",
    "tasks.nav.new": "Neue Aufgabe",
    "tasks:actions.edit": "Bearbeiten",

    "screen:task-list.title": "Aufgaben",
    "screen:task-edit.title": "Aufgabe",

    "tasks:entity:task:field:title": "Titel",
    "tasks:entity:task:field:status": "Status",
    "tasks:entity:task:field:priority": "Priorität",
    "tasks:entity:task:field:isUrgent": "Dringend",
    "tasks:entity:task:field:notes": "Notizen",
  },
  en: {
    "tasks.nav.list": "Tasks",
    "tasks.nav.new": "New task",
    "tasks:actions.edit": "Edit",

    "screen:task-list.title": "Tasks",
    "screen:task-edit.title": "Task",

    "tasks:entity:task:field:title": "Title",
    "tasks:entity:task:field:status": "Status",
    "tasks:entity:task:field:priority": "Priority",
    "tasks:entity:task:field:isUrgent": "Urgent",
    "tasks:entity:task:field:notes": "Notes",
  },
};
