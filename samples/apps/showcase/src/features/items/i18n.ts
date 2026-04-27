// Items-Feature i18n-Bundle. Convention: feature-prefix per
// `showcase:` + `entity:item:field:<name>` für Field-Labels. Plus
// die zwei Nav-Labels die in feature.ts referenziert werden.

import type { TranslationsByLocale } from "@kumiko/renderer";

export const itemsTranslations: TranslationsByLocale = {
  de: {
    "showcase:nav.list": "Items (Pages)",
    "showcase:nav.feed": "Items (Feed)",
    "showcase:nav.active-items": "Items (Active)",
    "showcase:nav.new": "Neuer Eintrag",
    "showcase:nav.quick-add": "Quick Add",
    "showcase:entity:item:field:title": "Titel",
    "showcase:entity:item:field:priority": "Priorität",
    "showcase:entity:item:field:isDone": "Erledigt?",
    "showcase:entity:item:field:status": "Status",
    "showcase:entity:item:field:notes": "Notizen",
    "showcase:entity:item:field:dueDate": "Fällig am",
    "screen:item-list.title": "Items (Pages)",
    "screen:item-feed.title": "Items (Feed)",
    "screen:item-active.title": "Items (Active)",
    "screen:item-quick-add.title": "Schnell-Anlage",
    "screen:item-edit.title": "Eintrag bearbeiten",
    "showcase:actions.delete": "Löschen",
    "showcase:actions.delete-confirm":
      "Eintrag wird unwiderruflich entfernt. Diese Aktion lässt sich nicht rückgängig machen.",
    "showcase:actions.quick-add": "Schnell anlegen",
    "showcase:actions.duplicate": "Duplizieren",
  },
  en: {
    "showcase:nav.list": "Items (Pages)",
    "showcase:nav.feed": "Items (Feed)",
    "showcase:nav.active-items": "Items (Active)",
    "showcase:nav.new": "New item",
    "showcase:nav.quick-add": "Quick Add",
    "showcase:entity:item:field:title": "Title",
    "showcase:entity:item:field:priority": "Priority",
    "showcase:entity:item:field:isDone": "Done?",
    "showcase:entity:item:field:status": "Status",
    "showcase:entity:item:field:notes": "Notes",
    "showcase:entity:item:field:dueDate": "Due date",
    "screen:item-list.title": "Items (Pages)",
    "screen:item-feed.title": "Items (Feed)",
    "screen:item-active.title": "Items (Active)",
    "screen:item-quick-add.title": "Quick add",
    "screen:item-edit.title": "Edit item",
    "showcase:actions.delete": "Delete",
    "showcase:actions.delete-confirm": "Item will be removed permanently. This cannot be undone.",
    "showcase:actions.quick-add": "Quick add",
    "showcase:actions.duplicate": "Duplicate",
  },
};
