// Assets-Feature — Server-Side. Schema-driven Asset-Tracker für die
// Marketing-Demo. defineFeature registriert Entity + CRUD-Handler +
// Screens. Audit + Multi-Tenant kommen aus dem Framework-Default.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { assetEditScreen, assetEntity, assetListScreen } from "./schema";

const open = { access: { openToAll: true } } as const;

// r.translations() wants key-first shape — same screen titles already in
// ./i18n's client (locale-first) bundle.
const REQUIRED_I18N = {
  "screen:asset-list.title": { de: "Assets", en: "Assets" },
  "screen:asset-edit.title": { de: "Asset bearbeiten", en: "Edit asset" },
} as const;

export const assetsFeature = defineFeature("assets", (r) => {
  r.translations({ keys: REQUIRED_I18N });

  r.crud("asset", assetEntity, { write: open, read: open });

  r.screen(assetEditScreen);
  r.screen(assetListScreen);

  // Sidebar-Nav — Labels via i18n-key, Bundle in features/assets/i18n.ts.
  r.nav({ id: "assets", label: "assets:nav.list", order: 10, screen: "assets:screen:asset-list" });
  r.nav({
    id: "asset-new",
    label: "assets:nav.new",
    parent: "assets:nav:assets",
    screen: "assets:screen:asset-edit",
    order: 10,
  });
});
