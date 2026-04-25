// Workspaces Showcase — server-side wiring. Two features prove the
// engine surface end-to-end:
//   * demo         — owns the Order entity, three screens, three
//                    workspaces, registers two nav entries explicitly
//                    listed in the admin workspace's nav array.
//   * demo-driver  — registers a nav that self-assigns to a workspace
//                    declared by `demo`, proving cross-feature
//                    membership via r.nav({ workspaces: [...] }).
//
// Three resolution surfaces meet in this file:
//   1. r.workspace.nav     — explicit list (admin)
//   2. r.nav.workspaces    — self-assignment (dispatch + driver, plus
//                            cross-feature from demo-driver)
//   3. WorkspaceShell      — picks active id from URL ?w=, filters the
//                            nav tree by membership.

import {
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
  type FeatureDefinition,
} from "@kumiko/framework/engine";
import { orderEditScreen, orderEntity, orderListScreen } from "./feature-schema";

export { orderEntity };

// All handlers open — demo-only. A real app would gate writes per role.
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

  // dispatch self-assigns the list via r.nav.workspaces (membership
  // source #2). admin lists it via r.workspace.nav below (source #1) —
  // the registry merges and dedupes.
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
  // audit-log lives in BOTH sources for admin: explicit r.workspace.nav
  // list AND self-assignment. The registry must dedupe — otherwise the
  // sidebar would render two identical entries. Keeps the dedup branch
  // exercised at the engine layer (renderer covers it from its own side).
  r.nav({
    id: "audit-log",
    label: "demo:nav.auditLog",
    workspaces: ["demo:workspace:admin"],
  });

  // Role-gating: jeder Workspace hat seinen eigenen `access.roles`. Admin
  // sieht alle drei (über die Admin-Rolle), spezialisierte Personas wie
  // Dispatcher/Driver würden nur ihren Workspace + ggf. cross-cutting
  // Bereiche sehen. Die WorkspaceShell ruft filterByAccess() mit
  // user.roles aus der Session — undefined-Rolle = nicht eingeloggt =
  // kein Workspace sichtbar.
  r.workspace({
    id: "admin",
    label: "demo:workspace.admin",
    icon: "settings",
    order: 1,
    access: { roles: ["Admin"] },
    // Explicit list AND audit-log self-assigns via r.nav.workspaces —
    // dedup test lives in the sample test file.
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

// Cross-feature: `demo-driver` registers a nav that self-assigns to
// demo's driver workspace. Proves r.nav.workspaces resolves QNs across
// feature boundaries — useful for teams who own one persona-package per
// driver/dispatcher/admin and bolt them onto a shared core feature.
export const driverFeature: FeatureDefinition = defineFeature("demo-driver", (r) => {
  r.nav({
    id: "my-tour",
    label: "demo-driver:nav.myTour",
    workspaces: ["demo:workspace:driver"],
  });
});
