import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { orderEditScreen, orderEntity, orderListScreen } from "./schema";

export { orderEntity };

const open = { access: { openToAll: true } } as const;

// r.translations() wants key-first shape — screen + entity-field labels
// aren't in ./i18n's client bundle (only nav/workspace labels are), so
// declared directly here.
const REQUIRED_I18N = {
  "screen:order-list.title": { de: "Aufträge", en: "Orders" },
  "screen:order-edit.title": { de: "Auftrag", en: "Order" },
  "demo:entity:order:field:label": { de: "Bezeichnung", en: "Label" },
  "demo:entity:order:field:status": { de: "Status", en: "Status" },
  "demo:entity:order:field:notes": { de: "Notizen", en: "Notes" },
  "demo:actions.edit": { de: "Bearbeiten", en: "Edit" },
} as const;

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
