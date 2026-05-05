// Assets-Feature — Server-Side. Schema-driven Asset-Tracker für die
// Marketing-Demo. defineFeature registriert Entity + CRUD-Handler +
// Screens. Audit + Multi-Tenant kommen aus dem Framework-Default.

import {
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { assetEditScreen, assetEntity, assetListScreen } from "./schema";

const open = { access: { openToAll: true } } as const;

export const assetsFeature = defineFeature("assets", (r) => {
  r.entity("asset", assetEntity);

  r.writeHandler(defineEntityCreateHandler("asset", assetEntity, open));
  r.writeHandler(defineEntityUpdateHandler("asset", assetEntity, open));
  r.writeHandler(defineEntityDeleteHandler("asset", assetEntity, open));
  r.queryHandler(defineEntityListHandler("asset", assetEntity, open));
  r.queryHandler(defineEntityDetailHandler("asset", assetEntity, open));

  r.screen(assetEditScreen);
  r.screen(assetListScreen);

  // Sidebar-Nav — Labels via i18n-key, Bundle in features/assets/i18n.ts.
  r.nav({ id: "assets", label: "assets:nav.list", order: 10, screen: "asset-list" });
  r.nav({
    id: "asset-new",
    label: "assets:nav.new",
    parent: "assets",
    screen: "asset-edit",
    order: 10,
  });
});
