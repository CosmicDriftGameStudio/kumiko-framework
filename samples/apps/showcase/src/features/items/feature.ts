// Items-Feature — Server-Side. defineFeature() registriert die Entity,
// die Standard-CRUD-Handler und die Schema-Items aus schema.ts. KEIN
// Custom-Server-Code (keine Hooks/Projections); das Feature ist
// bewusst minimal und zeigt den "kitchen-sink Entity"-Pfad ohne
// Domain-Logik.
//
// Beidseitig benutzte Schema-Definitionen leben in schema.ts. Server
// hängt hier die Handler dran und ruft r.screen/r.nav.

import { defineFeature, registerEntityCrud } from "@cosmicdrift/kumiko-framework/engine";
import {
  itemActiveScreen,
  itemEditScreen,
  itemEntity,
  itemFeedScreen,
  itemListScreen,
  itemQuickAddScreen,
} from "./schema";

const open = { access: { openToAll: true } } as const;

export const itemsFeature = defineFeature("showcase", (r) => {
  registerEntityCrud(r, "item", itemEntity, { write: open, read: open });

  r.screen(itemEditScreen);
  r.screen(itemListScreen);
  r.screen(itemFeedScreen);
  r.screen(itemActiveScreen);
  r.screen(itemQuickAddScreen);

  // Section "Data" — clickbar zum Auf/Zuklappen weil parent ohne screen.
  r.nav({ id: "data", label: "Data", order: 100 });
  r.nav({
    id: "item-list",
    label: "showcase:nav.list",
    parent: "showcase:nav:data",
    screen: "showcase:screen:item-list",
    order: 10,
  });
  r.nav({
    id: "item-feed",
    label: "showcase:nav.feed",
    parent: "showcase:nav:data",
    screen: "showcase:screen:item-feed",
    order: 15,
  });
  r.nav({
    id: "item-active",
    label: "showcase:nav.active-items",
    parent: "showcase:nav:data",
    screen: "showcase:screen:item-active",
    order: 17,
  });
  r.nav({
    id: "item-new",
    label: "showcase:nav.new",
    parent: "showcase:nav:data",
    screen: "showcase:screen:item-edit",
    order: 20,
  });
  r.nav({
    id: "item-quick-add",
    label: "showcase:nav.quick-add",
    parent: "showcase:nav:data",
    screen: "showcase:screen:item-quick-add",
    order: 25,
  });
});
