// Tests for projectAppSchemaForRoles (fw#3314). Pins:
//   1. LEAK INVARIANT — a role-gated screen disappears from EVERY reference
//      site the projection file header claims to cover for a denied role,
//      and survives — with the projection returning the exact input
//      reference — for a granted one: the screen itself, nav.screen, a
//      standalone nav's actions/createAction (TreeAction.screen), a content
//      collection's nav and its separate nav-copy actions/createAction, a
//      workspace's navMember + definition.nav, rowAction navigate by both
//      `screen` and `entity` (detailFor), a drawer rowAction/toolbarAction
//      (same-feature analog — see the comment on hostFeature below), a
//      toolbar navigate, a projectionDetail's header actions/metrics.navigate/
//      listScreenId, an entityEdit redirect, an actionForm redirect/
//      cancelTarget/listScreenId, a dashboard screen-panel, and every
//      relatedList-section field (actions/rowActions/toolbarActions/
//      rowClick.entity/emptyState.action). The denied-role assertion checks
//      this both structurally, per site, and by proving the secret screen
//      id is absent from the full serialized {screens, navs,
//      contentCollections} of every feature plus `workspaces` — not just
//      from the sites this file happened to think to check.
//   2. No mutation of the input schema.
//   3. Settings-Hub-generated configEdit screens/navs are gated by their
//      derived write-role access, same as author-registered ones.
//   4. Empty-section drop: a parent nav whose every child got dropped is
//      itself dropped.
//   5. Default-workspace drop: a workspace with no surviving nav members
//      is removed from the switcher list.
import { describe, expect, test } from "bun:test";
import { buildAppSchema } from "../build-app-schema.js";
import { access, createSystemConfig, createTenantConfig } from "../config-helpers.js";
import { defineFeature } from "../define-feature.js";
import { projectAppSchemaForRoles } from "../project-app-schema-for-roles.js";
import { createRegistry } from "../registry.js";

const SECRET_SCREEN_ID = "zz-secret-audit";
const ADMIN_ONLY = { roles: ["Admin"] } as const;

function findFeature(app: ReturnType<typeof buildAppSchema>, featureName: string) {
  const feature = app.features.find((f) => f.featureName === featureName);
  if (feature === undefined) throw new Error(`feature "${featureName}" missing from schema`);
  return feature;
}

describe("projectAppSchemaForRoles — leak invariant", () => {
  const SECRET_QN = `audit:screen:${SECRET_SCREEN_ID}`;

  const auditFeature = defineFeature("audit", (r) => {
    r.entity("record", { fields: { label: { type: "text" } } });
    r.screen({
      id: SECRET_SCREEN_ID,
      type: "entityList",
      entity: "record",
      columns: ["label"],
      detailFor: "record",
      access: ADMIN_ONLY,
    });
  });

  // "host-secret-form" is the drawer-action target below: RowActionDrawer/
  // ToolbarAction "drawer" resolve same-feature-only (validateDrawerTargetAction),
  // so SECRET_SCREEN_ID itself (a different feature) can never be a drawer
  // target — this is the one site the header lists that a real app could
  // never point cross-feature. Gating this screen the same way (ADMIN_ONLY)
  // proves the drawer-stripping code path with the closest valid analog.
  const hostFeature = defineFeature("host", (r) => {
    r.entity("hostRecord", { fields: { label: { type: "text" } } });

    r.nav({ id: "secret-nav", label: "Secret", screen: SECRET_QN });
    // Standalone grouping nav with no `.screen` of its own — isolates the
    // TreeAction-array stripping (actions/createAction) from the
    // whole-nav-drop path "secret-nav" above already exercises.
    r.nav({
      id: "browse",
      label: "Browse",
      actions: [{ icon: "eye", label: "Open", screen: SECRET_QN }],
      createAction: { icon: "plus", label: "New", screen: SECRET_QN },
    });

    r.contentCollection({
      id: "docs",
      kind: "text-block",
      nav: {
        label: "Docs",
        actions: [{ icon: "eye", label: "Open", screen: SECRET_QN }],
        createAction: { icon: "plus", label: "New", screen: SECRET_QN },
      },
    });

    r.workspace({ id: "audit-ws", label: "Audit WS", nav: ["host:nav:secret-nav"] });

    r.screen({
      id: "host-secret-form",
      type: "actionForm",
      handler: "host:write:noop",
      fields: { note: { type: "text" } },
      layout: { sections: [{ fields: ["note"] }] },
      access: ADMIN_ONLY,
    });

    r.screen({
      id: "list",
      type: "entityList",
      entity: "hostRecord",
      columns: ["label"],
      createScreen: "host-secret-form",
      rowActions: [
        { kind: "navigate", id: "open-secret", label: "Open", screen: SECRET_SCREEN_ID },
        { kind: "navigate", id: "open-secret-by-entity", label: "Open2", entity: "record" },
        { kind: "drawer", id: "open-secret-drawer", label: "Drawer", screen: "host-secret-form" },
      ],
      toolbarActions: [
        { kind: "navigate", id: "open-secret-tb", label: "Open", screen: SECRET_SCREEN_ID },
        {
          kind: "drawer",
          id: "open-secret-drawer-tb",
          label: "DrawerTB",
          screen: "host-secret-form",
        },
      ],
      expandableRow: {
        kind: "relatedList",
        title: "Expanded",
        query: "host:query:record:related",
        columns: ["label"],
        rowClick: { entity: "record" },
        actions: [{ kind: "navigate", id: "ex-actions", label: "Ex", screen: SECRET_SCREEN_ID }],
        rowActions: [{ kind: "navigate", id: "ex-row", label: "ExRow", screen: SECRET_SCREEN_ID }],
        toolbarActions: [
          { kind: "navigate", id: "ex-tb", label: "ExTb", screen: SECRET_SCREEN_ID },
        ],
        emptyState: {
          title: "none",
          action: { kind: "navigate", id: "ex-empty", label: "Empty", screen: SECRET_SCREEN_ID },
        },
      },
    });
    r.screen({
      id: "edit",
      type: "entityEdit",
      entity: "hostRecord",
      layout: { sections: [{ fields: ["label"] }] },
      redirect: SECRET_QN,
    });
    r.screen({
      id: "board",
      type: "dashboard",
      panels: [{ kind: "screen", id: "secret-panel", screen: SECRET_QN }],
    });
    r.screen({
      id: "host-action",
      type: "actionForm",
      handler: "host:write:noop",
      fields: { note: { type: "text" } },
      layout: { sections: [{ fields: ["note"] }] },
      redirect: SECRET_QN,
      cancelTarget: SECRET_QN,
      listScreenId: SECRET_SCREEN_ID,
    });
    r.screen({
      id: "detail",
      type: "projectionDetail",
      query: "host:query:record:detail",
      layout: {
        sections: [
          { fields: ["label"] },
          // relatedList is only valid on projectionDetail (fw#2166) — the
          // boot-validator rejects it on entityEdit/actionForm/configEdit,
          // so this is the closest valid host for its own site set.
          {
            kind: "relatedList",
            title: "Related",
            query: "host:query:record:related",
            columns: ["label"],
            rowClick: { entity: "record" },
            actions: [
              { kind: "navigate", id: "rl-actions", label: "RL", screen: SECRET_SCREEN_ID },
            ],
            rowActions: [
              { kind: "navigate", id: "rl-row", label: "RLRow", screen: SECRET_SCREEN_ID },
            ],
            toolbarActions: [
              { kind: "navigate", id: "rl-tb", label: "RLTb", screen: SECRET_SCREEN_ID },
            ],
            emptyState: {
              title: "none",
              action: {
                kind: "navigate",
                id: "rl-empty",
                label: "Empty",
                screen: SECRET_SCREEN_ID,
              },
            },
          },
        ],
      },
      actions: [
        { kind: "navigate", id: "detail-header-action", label: "Header", screen: SECRET_SCREEN_ID },
      ],
      metrics: [{ field: "label", navigate: { screen: SECRET_SCREEN_ID } }],
      listScreenId: SECRET_SCREEN_ID,
    });
  });

  const registry = createRegistry([auditFeature, hostFeature]);
  const app = buildAppSchema(registry);

  // Sanity: the absence check below isn't vacuous — the unprojected schema
  // really does repeat the id this many times across the wired sites.
  test("sanity: the unprojected schema contains the secret screen id many times", () => {
    const occurrences = JSON.stringify(app).split(SECRET_SCREEN_ID).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(15);
  });

  test("granted role returns the identical schema — every site survives untouched", () => {
    const projected = projectAppSchemaForRoles(app, ["Admin"]);
    expect(projected).toBe(app);
  });

  test("granted role: per-site structural spot checks", () => {
    const projected = projectAppSchemaForRoles(app, ["Admin"]);
    const audit = findFeature(projected, "audit");
    expect(audit.screens.map((s) => s.id)).toContain(SECRET_SCREEN_ID);

    const host = findFeature(projected, "host");
    expect(host.navs?.find((n) => n.id === "secret-nav")).toBeDefined();
    const browse = host.navs?.find((n) => n.id === "browse");
    expect(browse?.actions).toHaveLength(1);
    expect(browse?.createAction).toBeDefined();

    const docs = host.contentCollections?.find((c) => c.id === "docs");
    expect(docs?.nav.actions).toHaveLength(1);
    expect(docs?.nav.createAction).toBeDefined();

    expect(projected.workspaces?.some((w) => w.definition.id === "audit-ws")).toBe(true);

    const list = host.screens.find((s) => s.id === "list");
    expect(list?.type).toBe("entityList");
    if (list?.type !== "entityList") throw new Error("unreachable");
    expect(list.rowActions).toHaveLength(3);
    expect(list.toolbarActions).toHaveLength(2);
    expect(list.createScreen).toBe("host-secret-form");
    expect(list.expandableRow?.actions).toHaveLength(1);
    expect(list.expandableRow?.rowActions).toHaveLength(1);
    expect(list.expandableRow?.toolbarActions).toHaveLength(1);
    expect(list.expandableRow?.rowClick).toEqual({ entity: "record" });
    expect(list.expandableRow?.emptyState?.action).toBeDefined();

    const edit = host.screens.find((s) => s.id === "edit");
    expect(edit?.type).toBe("entityEdit");
    if (edit?.type !== "entityEdit") throw new Error("unreachable");
    expect(edit.redirect).toBe(SECRET_QN);

    const board = host.screens.find((s) => s.id === "board");
    expect(board?.type).toBe("dashboard");
    if (board?.type !== "dashboard") throw new Error("unreachable");
    expect(board.panels).toHaveLength(1);

    const hostAction = host.screens.find((s) => s.id === "host-action");
    expect(hostAction?.type).toBe("actionForm");
    if (hostAction?.type !== "actionForm") throw new Error("unreachable");
    expect(hostAction.redirect).toBe(SECRET_QN);
    expect(hostAction.cancelTarget).toBe(SECRET_QN);
    expect(hostAction.listScreenId).toBe(SECRET_SCREEN_ID);

    const detail = host.screens.find((s) => s.id === "detail");
    expect(detail?.type).toBe("projectionDetail");
    if (detail?.type !== "projectionDetail") throw new Error("unreachable");
    expect(detail.metrics?.[0]).toEqual({ field: "label", navigate: { screen: SECRET_SCREEN_ID } });
    expect(detail.actions).toHaveLength(1);
    expect(detail.listScreenId).toBe(SECRET_SCREEN_ID);
    const relatedList = detail.layout.sections.find((s) => s.kind === "relatedList");
    expect(relatedList?.kind).toBe("relatedList");
    if (relatedList?.kind !== "relatedList") throw new Error("unreachable");
    expect(relatedList.actions).toHaveLength(1);
    expect(relatedList.rowActions).toHaveLength(1);
    expect(relatedList.toolbarActions).toHaveLength(1);
    expect(relatedList.rowClick).toEqual({ entity: "record" });
    expect(relatedList.emptyState?.action).toBeDefined();
  });

  test("denied role: the secret screen id disappears from every projected feature and from workspaces", () => {
    const projected = projectAppSchemaForRoles(app, ["User"]);
    for (const feature of projected.features) {
      const featureJson = JSON.stringify({
        screens: feature.screens,
        navs: feature.navs,
        contentCollections: feature.contentCollections,
      });
      expect(featureJson).not.toContain(SECRET_SCREEN_ID);
    }
    expect(JSON.stringify(projected.workspaces ?? null)).not.toContain(SECRET_SCREEN_ID);
  });

  test("denied role: per-site structural spot checks", () => {
    const projected = projectAppSchemaForRoles(app, ["User"]);
    const audit = findFeature(projected, "audit");
    expect(audit.screens.map((s) => s.id)).not.toContain(SECRET_SCREEN_ID);

    const host = findFeature(projected, "host");
    expect(host.navs?.find((n) => n.id === "secret-nav")).toBeUndefined();
    const browse = host.navs?.find((n) => n.id === "browse");
    expect(browse?.actions).toBeUndefined();
    expect(browse?.createAction).toBeUndefined();

    const docs = host.contentCollections?.find((c) => c.id === "docs");
    expect(docs?.nav.actions).toBeUndefined();
    expect(docs?.nav.createAction).toBeUndefined();

    // "audit-ws" was the only workspace, so losing its only member drops the
    // workspace itself — omitted entirely (undefined), not an empty array.
    expect(projected.workspaces?.some((w) => w.definition.id === "audit-ws") ?? false).toBe(false);

    const list = host.screens.find((s) => s.id === "list");
    expect(list?.type).toBe("entityList");
    if (list?.type !== "entityList") throw new Error("unreachable");
    // "open-secret-drawer"/"-tb" target "host-secret-form", itself
    // ADMIN_ONLY — stripped for User too (same-feature drawer analog, see
    // the comment on hostFeature above).
    expect(list.rowActions).toBeUndefined();
    expect(list.toolbarActions).toBeUndefined();
    expect(list.createScreen).toBeUndefined();
    // The sub-list itself stays (its query is not a screen target); only the
    // navigate sites into the denied screen are stripped.
    expect(list.expandableRow?.title).toBe("Expanded");
    expect(list.expandableRow?.actions).toBeUndefined();
    expect(list.expandableRow?.rowActions).toBeUndefined();
    expect(list.expandableRow?.toolbarActions).toBeUndefined();
    expect(list.expandableRow?.rowClick).toBeUndefined();
    expect(list.expandableRow?.emptyState?.action).toBeUndefined();

    const edit = host.screens.find((s) => s.id === "edit");
    expect(edit?.type).toBe("entityEdit");
    if (edit?.type !== "entityEdit") throw new Error("unreachable");
    expect(edit.redirect).toBeUndefined();

    const board = host.screens.find((s) => s.id === "board");
    expect(board?.type).toBe("dashboard");
    if (board?.type !== "dashboard") throw new Error("unreachable");
    expect(board.panels).toHaveLength(0);

    const hostAction = host.screens.find((s) => s.id === "host-action");
    expect(hostAction?.type).toBe("actionForm");
    if (hostAction?.type !== "actionForm") throw new Error("unreachable");
    expect(hostAction.redirect).toBeUndefined();
    expect(hostAction.cancelTarget).toBeUndefined();
    expect(hostAction.listScreenId).toBeUndefined();

    const detail = host.screens.find((s) => s.id === "detail");
    expect(detail?.type).toBe("projectionDetail");
    if (detail?.type !== "projectionDetail") throw new Error("unreachable");
    expect(detail.metrics?.[0]).toEqual({ field: "label" });
    expect(detail.actions).toBeUndefined();
    expect(detail.listScreenId).toBeUndefined();
    const relatedList = detail.layout.sections.find((s) => s.kind === "relatedList");
    expect(relatedList?.kind).toBe("relatedList");
    if (relatedList?.kind !== "relatedList") throw new Error("unreachable");
    expect(relatedList.actions).toBeUndefined();
    expect(relatedList.rowActions).toBeUndefined();
    expect(relatedList.toolbarActions).toBeUndefined();
    expect(relatedList.rowClick).toBeUndefined();
    expect(relatedList.emptyState?.action).toBeUndefined();
  });
});

describe("projectAppSchemaForRoles — no mutation", () => {
  test("never mutates the input schema", () => {
    const feature = defineFeature("widgets", (r) => {
      r.entity("widget", { fields: { name: { type: "text" } } });
      r.screen({
        id: "secret",
        type: "entityList",
        entity: "widget",
        columns: ["name"],
        access: ADMIN_ONLY,
      });
      r.screen({ id: "list", type: "entityList", entity: "widget", columns: ["name"] });
      r.nav({ id: "secret", label: "Secret", screen: "secret" });
      r.nav({ id: "list", label: "List", screen: "list" });
    });
    const app = buildAppSchema(createRegistry([feature]));
    const before = JSON.stringify(app);

    projectAppSchemaForRoles(app, ["User"]);
    projectAppSchemaForRoles(app, ["Admin"]);

    expect(JSON.stringify(app)).toBe(before);
  });

  test("returns the identical reference when a fully-open role changes nothing", () => {
    const feature = defineFeature("open-widgets", (r) => {
      r.entity("widget", { fields: { name: { type: "text" } } });
      r.screen({ id: "list", type: "entityList", entity: "widget", columns: ["name"] });
      r.nav({ id: "list", label: "List", screen: "list" });
    });
    const app = buildAppSchema(createRegistry([feature]));
    const projected = projectAppSchemaForRoles(app, ["Whatever"]);
    expect(projected).toBe(app);
  });
});

describe("projectAppSchemaForRoles — Settings-Hub visibility", () => {
  const billing = defineFeature("billing", (r) => {
    r.config({
      keys: {
        stripeKey: createTenantConfig("text", { mask: { title: "billing.stripe-key" } }),
        platformFee: createSystemConfig("number", {
          write: access.systemAdmin,
          mask: { title: "billing.platform-fee" },
        }),
      },
    });
  });
  const app = buildAppSchema(createRegistry([billing]));

  test("Admin sees the tenant-scoped hub screen but not the SystemAdmin-only one", () => {
    const projected = projectAppSchemaForRoles(app, ["Admin"]);
    const config = projected.features.find((f) => f.featureName === "config");
    expect(config?.screens.map((s) => s.id)).toContain("billing-tenant");
    expect(config?.screens.map((s) => s.id)).not.toContain("billing-system");
    expect(config?.navs?.map((n) => n.id)).toContain("billing-tenant");
    expect(config?.navs?.map((n) => n.id)).not.toContain("billing-system");
  });

  test("plain User sees neither hub screen", () => {
    const projected = projectAppSchemaForRoles(app, ["User"]);
    const config = projected.features.find((f) => f.featureName === "config");
    expect(config?.screens.map((s) => s.id)).not.toContain("billing-tenant");
    expect(config?.screens.map((s) => s.id)).not.toContain("billing-system");
  });
});

describe("projectAppSchemaForRoles — nav pruning", () => {
  test("a parent nav whose only child gets dropped is itself dropped (empty section)", () => {
    const feature = defineFeature("menu", (r) => {
      r.entity("widget", { fields: { name: { type: "text" } } });
      r.nav({ id: "section", label: "Section" }); // pure grouping node, no screen
      r.nav({
        id: "child",
        label: "Child",
        parent: "menu:nav:section",
        screen: "child-screen",
        access: ADMIN_ONLY,
      });
      r.screen({
        id: "child-screen",
        type: "entityList",
        entity: "widget",
        columns: ["name"],
        access: ADMIN_ONLY,
      });
    });
    const app = buildAppSchema(createRegistry([feature]));

    const forAdmin = projectAppSchemaForRoles(app, ["Admin"]);
    const adminMenu = findFeature(forAdmin, "menu");
    expect(adminMenu.navs?.map((n) => n.id).sort()).toEqual(["child", "section"]);

    const forUser = projectAppSchemaForRoles(app, ["User"]);
    const userMenu = findFeature(forUser, "menu");
    expect(userMenu.navs).toBeUndefined();
  });

  test("a descendant three levels deep is dropped when its own access denies", () => {
    const feature = defineFeature("tree", (r) => {
      r.entity("widget", { fields: { name: { type: "text" } } });
      r.nav({ id: "root", label: "Root" });
      r.nav({ id: "mid", label: "Mid", parent: "tree:nav:root" });
      r.nav({
        id: "leaf",
        label: "Leaf",
        parent: "tree:nav:mid",
        screen: "leaf-screen",
        access: ADMIN_ONLY,
      });
      r.screen({
        id: "leaf-screen",
        type: "entityList",
        entity: "widget",
        columns: ["name"],
        access: ADMIN_ONLY,
      });
    });
    const app = buildAppSchema(createRegistry([feature]));

    const forUser = projectAppSchemaForRoles(app, ["User"]);
    const userTree = findFeature(forUser, "tree");
    expect(userTree.navs).toBeUndefined(); // root+mid become empty sections too
  });
});

describe("projectAppSchemaForRoles — workspace pruning", () => {
  test("drops the default workspace when its role loses every member, and keeps the other one", () => {
    const feature = defineFeature("shell", (r) => {
      r.entity("widget", { fields: { name: { type: "text" } } });
      r.screen({
        id: "admin-home",
        type: "entityList",
        entity: "widget",
        columns: ["name"],
        access: ADMIN_ONLY,
      });
      r.screen({ id: "user-home", type: "entityList", entity: "widget", columns: ["name"] });
      r.nav({ id: "admin-home", label: "Admin Home", screen: "admin-home" });
      r.nav({ id: "user-home", label: "User Home", screen: "user-home" });
      r.workspace({ id: "admin", label: "Admin", default: true, nav: ["shell:nav:admin-home"] });
      r.workspace({ id: "user", label: "User", nav: ["shell:nav:user-home"] });
    });
    const app = buildAppSchema(createRegistry([feature]));

    const forUser = projectAppSchemaForRoles(app, ["User"]);
    const ids = forUser.workspaces?.map((w) => w.definition.id);
    expect(ids).toEqual(["user"]);

    const forAdmin = projectAppSchemaForRoles(app, ["Admin"]);
    expect(forAdmin.workspaces?.map((w) => w.definition.id).sort()).toEqual(["admin", "user"]);
  });

  test("keeps a workspace that was declared without members instead of treating it as emptied", () => {
    const feature = defineFeature("shell", (r) => {
      r.entity("widget", { fields: { name: { type: "text" } } });
      r.screen({ id: "user-home", type: "entityList", entity: "widget", columns: ["name"] });
      r.nav({ id: "user-home", label: "User Home", screen: "user-home" });
      r.workspace({ id: "work", label: "Work", nav: ["shell:nav:user-home"] });
      r.workspace({ id: "empty", label: "Empty" });
    });
    const app = buildAppSchema(createRegistry([feature]));
    expect(app.workspaces?.find((w) => w.definition.id === "empty")?.navMembers).toEqual([]);

    const forUser = projectAppSchemaForRoles(app, ["User"]);

    expect(forUser.workspaces?.map((w) => w.definition.id).sort()).toEqual(["empty", "work"]);
  });
});
