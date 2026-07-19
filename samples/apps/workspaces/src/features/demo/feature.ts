import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { demoTranslations } from "./i18n";
import { orderEditScreen, orderEntity, orderListScreen } from "./schema";

export { orderEntity };

const open = { access: { openToAll: true } } as const;

// r.translations() wants key-first shape ({key: {de, en}}); demoTranslations
// (nav/workspace labels) is locale-first (client TranslationsByLocale shape)
// — invert here (bracket notation + fallback avoids TS4111/TS18048 under
// noUncheckedIndexedAccess), then add the screen/entity-field/action keys
// that aren't in the client bundle at all.
const REQUIRED_I18N: Record<string, { de: string; en: string }> = {
  ...Object.fromEntries(
    Object.keys(demoTranslations["de"] ?? {}).map((key) => [
      key,
      { de: demoTranslations["de"]?.[key] ?? "", en: demoTranslations["en"]?.[key] ?? "" },
    ]),
  ),
  "screen:order-list.title": { de: "Aufträge", en: "Orders" },
  "screen:order-edit.title": { de: "Auftrag", en: "Order" },
  "demo:entity:order:field:label": { de: "Bezeichnung", en: "Label" },
  "demo:entity:order:field:status": { de: "Status", en: "Status" },
  "demo:entity:order:field:notes": { de: "Notizen", en: "Notes" },
  "demo:actions.edit": { de: "Bearbeiten", en: "Edit" },
};

export const demoFeature: FeatureDefinition = defineFeature("demo", (r) => {
  r.translations({ keys: REQUIRED_I18N });

  r.crud("order", orderEntity, { write: open, read: open });
  r.screen(orderListScreen);
  r.screen(orderEditScreen);

  r.nav({
    id: "order-list",
    label: "demo:nav.orderList",
    screen: "demo:screen:order-list",
    workspaces: ["demo:workspace:dispatch"],
  });
  r.nav({
    id: "order-edit",
    label: "demo:nav.orderNew",
    screen: "demo:screen:order-edit",
    workspaces: ["demo:workspace:driver"],
  });
  r.nav({
    id: "audit-log",
    label: "demo:nav.auditLog",
    workspaces: ["demo:workspace:admin"],
  });

  r.workspace({
    id: "admin",
    label: "demo:workspace.admin",
    icon: "settings",
    order: 1,
    access: { roles: ["Admin"] },
    nav: ["demo:nav:order-list", "demo:nav:order-edit", "demo:nav:audit-log"],
    default: true,
  });
  r.workspace({
    id: "dispatch",
    label: "demo:workspace.dispatch",
    icon: "list",
    order: 2,
    access: { roles: ["Dispatcher", "Admin"] },
  });
  r.workspace({
    id: "driver",
    label: "demo:workspace.driver",
    icon: "user",
    order: 3,
    access: { roles: ["Driver", "Admin"] },
  });
});
