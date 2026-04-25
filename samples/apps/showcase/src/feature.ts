// Server-Seite des Showcase-Features. Registriert die Item-Entity +
// die zwei Screens + zwei Navs. Handlers sind die Standard-CRUD-
// Helper aus framework/engine — keine Custom-Business-Logik nötig,
// das Sample fokussiert auf die Renderer-Surface, nicht auf Domain.

import {
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
} from "@kumiko/framework/engine";
import { itemEditScreen, itemEntity, itemListScreen } from "./feature-schema";

// Re-export — server.ts braucht's für createEntityTable im onAfterSetup.
export { itemEntity };

// All-open: das Sample demonstriert die UI, nicht die Auth-Pipeline.
const open = { access: { openToAll: true } } as const;

export const showcaseFeature = defineFeature("showcase", (r) => {
  r.entity("item", itemEntity);

  r.writeHandler(defineEntityWriteHandler("item:create", itemEntity, open));
  r.writeHandler(defineEntityWriteHandler("item:update", itemEntity, open));
  r.writeHandler(defineEntityWriteHandler("item:delete", itemEntity, open));
  r.queryHandler(defineEntityQueryHandler("item:list", itemEntity, open));
  r.queryHandler(defineEntityQueryHandler("item:detail", itemEntity, open));

  r.screen(itemEditScreen);
  r.screen(itemListScreen);

  r.nav({ id: "item-list", label: "showcase:nav.list", screen: "item-list", order: 10 });
  r.nav({ id: "item-new", label: "showcase:nav.new", screen: "item-edit", order: 20 });
});
