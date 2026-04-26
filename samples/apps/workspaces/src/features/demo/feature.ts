// Demo-Feature: Order-Entity, drei Screens, drei Workspaces, mehrere
// Navs mit unterschiedlichen Membership-Quellen (r.workspace.nav vs
// r.nav.workspaces). Beweist dass die Registry beide Quellen mergen
// und deduplizieren kann.
//
// Drei Resolution-Surfaces meet hier zusammen:
//   1. r.workspace.nav     — explizite Liste (admin)
//   2. r.nav.workspaces    — Self-Assignment (dispatch + driver)
//   3. WorkspaceShell      — picks active id von URL ?w=, filtert Tree
//                            nach Membership.

import {
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
  type FeatureDefinition,
} from "@kumiko/framework/engine";
import { orderEditScreen, orderEntity, orderListScreen } from "./schema";

export { orderEntity };

const open = { access: { openToAll: true } } as const;

export const demoFeature: FeatureDefinition = defineFeature("demo", (r) => {
  r.entity("order", orderEntity);
  r.writeHandler(defineEntityWriteHandler("order:create", orderEntity, open));
  r.writeHandler(defineEntityWriteHandler("order:update", orderEntity, open));
  r.writeHandler(defineEntityWriteHandler("order:delete", orderEntity, open));
  r.queryHandler(defineEntityQueryHandler("order:list", orderEntity, open));
  r.queryHandler(defineEntityQueryHandler("order:detail", orderEntity, open));
  r.screen(orderListScreen);
  r.screen(orderEditScreen);

  // dispatch self-assigns die Liste über r.nav.workspaces (Quelle #2);
  // admin listet sie über r.workspace.nav unten (Quelle #1) — Registry
  // merged + dedupliziert.
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
  // audit-log lebt in BEIDEN Quellen für admin: explizite r.workspace.nav
  // PLUS Self-Assignment. Registry muss dedupen — sonst würden zwei
  // identische Einträge in der Sidebar erscheinen.
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
