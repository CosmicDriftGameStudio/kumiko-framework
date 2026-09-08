// Items-Feature — Server-Side. defineFeature() registriert die Entity,
// die Standard-CRUD-Handler und die Schema-Items aus schema.ts. KEIN
// Custom-Server-Code (keine Hooks/Projections); das Feature ist
// bewusst minimal und zeigt den "kitchen-sink Entity"-Pfad ohne
// Domain-Logik.
//
// Beidseitig benutzte Schema-Definitionen leben in schema.ts. Server
// hängt hier die Handler dran und ruft r.screen/r.nav.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { itemsTranslations } from "./i18n";
import {
  itemActiveScreen,
  itemEditScreen,
  itemEntity,
  itemFeedScreen,
  itemListScreen,
  itemQuickAddScreen,
} from "./schema";

const open = { access: { openToAll: true } } as const;

// The boot validator checks server-registered keys, while the client bundle is
// locale-first — flip it rather than maintaining the same strings twice.
function keyFirst(byLocale: typeof itemsTranslations): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [locale, entries] of Object.entries(byLocale)) {
    for (const [key, value] of Object.entries(entries)) {
      out[key] ??= {};
      out[key][locale] = value;
    }
  }
  return out;
}

export const itemsFeature = defineFeature("showcase", (r) => {
  r.translations({ keys: keyFirst(itemsTranslations) });
  r.crud("item", itemEntity, {
    write: open,
    read: open,
    descriptions: {
      create:
        "Creates one showcase item from title, notes, priority, done flag, due date, status and its parent/related item references; used by the item edit screen and by the quick-add action form, which supplies only title and priority and leaves the rest on their defaults.",
      update:
        "Applies changed item fields to one existing row, addressed by id plus the version the client last read; used when the item edit screen saves.",
      delete:
        "Removes one item row for good, addressed by id; used by the danger row action on the item list, and there is no restore because the entity is not soft-deleted.",
      list: "Returns one page of items with search, sorting, an optional fixed status filter and the parent/related references already resolved to their titles; used by the paged item list, the infinite-scroll feed, the active-items screen and the reference comboboxes on the edit form.",
      detail:
        "Returns one item by id with its parent and related references resolved; used when the item edit screen loads an existing row.",
    },
  });

  r.screen(itemEditScreen);
  r.screen(itemListScreen);
  r.screen(itemFeedScreen);
  r.screen(itemActiveScreen);
  r.screen(itemQuickAddScreen);

  // Section "Data" — clickbar zum Auf/Zuklappen weil parent ohne screen.
  r.nav({ id: "data", label: "showcase:nav.data", icon: "table", order: 100 });
  r.nav({
    id: "item-list",
    icon: "table",
    label: "showcase:nav.list",
    parent: "showcase:nav:data",
    screen: "showcase:screen:item-list",
    order: 10,
  });
  r.nav({
    id: "item-feed",
    icon: "list",
    label: "showcase:nav.feed",
    parent: "showcase:nav:data",
    screen: "showcase:screen:item-feed",
    order: 15,
  });
  r.nav({
    id: "item-active",
    icon: "gauge",
    label: "showcase:nav.active-items",
    parent: "showcase:nav:data",
    screen: "showcase:screen:item-active",
    order: 17,
  });
  r.nav({
    id: "item-new",
    icon: "plus",
    label: "showcase:nav.new",
    parent: "showcase:nav:data",
    screen: "showcase:screen:item-edit",
    order: 20,
  });
  r.nav({
    id: "item-quick-add",
    icon: "sparkles",
    label: "showcase:nav.quick-add",
    parent: "showcase:nav:data",
    screen: "showcase:screen:item-quick-add",
    order: 25,
  });
});
