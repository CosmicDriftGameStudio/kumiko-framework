// Items-Feature i18n-Bundle. Convention: feature-prefix per
// `showcase:` + `entity:item:field:<name>` für Field-Labels. Plus
// die zwei Nav-Labels die in feature.ts referenziert werden.

import type { TranslationsByLocale } from "@kumiko/renderer";

export const itemsTranslations: TranslationsByLocale = {
  de: {
    "showcase:nav.list": "Items",
    "showcase:nav.new": "Neuer Eintrag",
    "showcase:entity:item:field:title": "Titel",
    "showcase:entity:item:field:priority": "Priorität",
    "showcase:entity:item:field:isDone": "Erledigt?",
    "showcase:entity:item:field:status": "Status",
    "showcase:entity:item:field:notes": "Notizen",
    "showcase:entity:item:field:dueDate": "Fällig am",
    "screen:item-list.title": "Items",
    "screen:item-edit.title": "Eintrag bearbeiten",
  },
  en: {
    "showcase:nav.list": "Items",
    "showcase:nav.new": "New item",
    "showcase:entity:item:field:title": "Title",
    "showcase:entity:item:field:priority": "Priority",
    "showcase:entity:item:field:isDone": "Done?",
    "showcase:entity:item:field:status": "Status",
    "showcase:entity:item:field:notes": "Notes",
    "showcase:entity:item:field:dueDate": "Due date",
    "screen:item-list.title": "Items",
    "screen:item-edit.title": "Edit item",
  },
};
