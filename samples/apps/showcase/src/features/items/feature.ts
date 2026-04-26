// Items-Feature — Server-Side. defineFeature() registriert die Entity,
// die Standard-CRUD-Handler und die Schema-Items aus schema.ts. KEIN
// Custom-Server-Code (keine Hooks/Projections); das Feature ist
// bewusst minimal und zeigt den "kitchen-sink Entity"-Pfad ohne
// Domain-Logik.
//
// Beidseitig benutzte Schema-Definitionen leben in schema.ts. Server
// hängt hier die Handler dran und ruft r.entity/r.screen/r.nav.

import {
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
} from "@kumiko/framework/engine";
import { itemEditScreen, itemEntity, itemListScreen } from "./schema";

const open = { access: { openToAll: true } } as const;

export const itemsFeature = defineFeature("showcase", (r) => {
  r.entity("item", itemEntity);

  r.writeHandler(defineEntityWriteHandler("item:create", itemEntity, open));
  r.writeHandler(defineEntityWriteHandler("item:update", itemEntity, open));
  r.writeHandler(defineEntityWriteHandler("item:delete", itemEntity, open));
  r.queryHandler(defineEntityQueryHandler("item:list", itemEntity, open));
  r.queryHandler(defineEntityQueryHandler("item:detail", itemEntity, open));

  r.screen(itemEditScreen);
  r.screen(itemListScreen);

  // Section "Data" — clickbar zum Auf/Zuklappen weil parent ohne screen.
  r.nav({ id: "data", label: "Data", order: 100 });
  r.nav({
    id: "item-list",
    label: "showcase:nav.list",
    parent: "data",
    screen: "item-list",
    order: 10,
  });
  r.nav({
    id: "item-new",
    label: "showcase:nav.new",
    parent: "data",
    screen: "item-edit",
    order: 20,
  });
});
