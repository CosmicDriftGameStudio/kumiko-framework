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

  // Demo-Screens: id-only (type custom). Der Client routet die screenIds
  // zu eigenen React-Components — dafür reicht hier die ID. PlatformComponent
  // bleibt leer, weil die Component-Map client-seitig in client.tsx hängt.
  r.screen({ id: "demo-buttons", type: "custom", renderer: {} });
  r.screen({ id: "demo-inputs", type: "custom", renderer: {} });
  r.screen({ id: "demo-banner", type: "custom", renderer: {} });
  r.screen({ id: "demo-text", type: "custom", renderer: {} });

  // Section-Header oben: PRIMITIVES (kein screen → toggle-able Section).
  r.nav({ id: "primitives", label: "Primitives", order: 10 });
  r.nav({
    id: "demo-buttons",
    label: "Buttons",
    parent: "primitives",
    screen: "demo-buttons",
    order: 10,
  });
  r.nav({
    id: "demo-inputs",
    label: "Inputs",
    parent: "primitives",
    screen: "demo-inputs",
    order: 20,
  });
  r.nav({
    id: "demo-banner",
    label: "Banner",
    parent: "primitives",
    screen: "demo-banner",
    order: 30,
  });
  r.nav({ id: "demo-text", label: "Text", parent: "primitives", screen: "demo-text", order: 40 });

  // Section unten: DATA — die echten Item-Screens.
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
