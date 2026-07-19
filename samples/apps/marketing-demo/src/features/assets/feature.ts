// Assets-Feature — Server-Side. Schema-driven Asset-Tracker für die
// Marketing-Demo. defineFeature registriert Entity + CRUD-Handler +
// Screens. Audit + Multi-Tenant kommen aus dem Framework-Default.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { assetsTranslations } from "./i18n";
import { assetEditScreen, assetEntity, assetListScreen } from "./schema";

const open = { access: { openToAll: true } } as const;

// r.translations() wants key-first shape ({key: {de, en}}); assetsTranslations
// is locale-first (client TranslationsByLocale shape) — invert here rather
// than duplicating the strings.
const REQUIRED_I18N = Object.fromEntries(
  Object.keys(assetsTranslations.de).map((key) => [
    key,
    { de: assetsTranslations.de[key], en: assetsTranslations.en[key] },
  ]),
);

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
