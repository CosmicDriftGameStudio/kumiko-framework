// End-to-end Settings-Hub visibility on the REAL boot path:
//   createRegistry → buildAppSchema → buildNavRegistrySliceForApp → resolveNavigation.
// These are the actual functions the shell runs at boot; no stubs. Proves a
// config key declared with `mask` surfaces as a role-filtered nav tree that
// only shows inside its own synthetic "settings" workspace.

import { describe, expect, test } from "bun:test";
import {
  access,
  buildAppSchema,
  createRegistry,
  createSystemConfig,
  createTenantConfig,
  createUserConfig,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { resolveNavigation } from "@cosmicdrift/kumiko-headless";
import { buildNavRegistrySliceForApp } from "../nav-tree";

const billing = defineFeature("billing", (r) => {
  r.config({
    keys: {
      stripeKey: createTenantConfig("text", { mask: { title: "billing.stripe-key" } }),
      // system-scope default write = ["system"] (internal actor) → human-hidden
      platformFee: createSystemConfig("number", { mask: { title: "billing.platform-fee" } }),
    },
  });
});
const notify = defineFeature("notify", (r) => {
  r.config({
    keys: { digest: createUserConfig("boolean", { mask: { title: "notify.digest" } }) },
  });
});
// A system-scope key that explicitly opts a HUMAN role into write → its
// settings entry becomes visible to that admin (the opt-in path).
const ops = defineFeature("ops", (r) => {
  r.config({
    keys: {
      maintenanceMode: createSystemConfig("boolean", {
        write: access.systemAdmin,
        mask: { title: "ops.maintenance" },
      }),
    },
  });
});
// A real work-workspace, so the app is in workspace (filter) mode.
const shell = defineFeature("shell", (r) => {
  r.entity("thing", { fields: { label: { type: "text" } } });
  r.screen({ id: "home", type: "entityList", entity: "thing", columns: ["label"] });
  r.nav({ id: "home", label: "Home", screen: "home" });
  r.workspace({ id: "main", label: "Main", nav: ["shell:nav:home"] });
});

const app = buildAppSchema(createRegistry([shell, billing, notify, ops]));

function navMembersOf(workspaceId: string): ReadonlySet<string> {
  const ws = app.workspaces?.find((w) => w.definition.id === workspaceId);
  if (ws === undefined) throw new Error(`no workspace "${workspaceId}"`);
  return new Set(ws.navMembers);
}

function qualifiedNames(tree: ReturnType<typeof resolveNavigation>): string[] {
  const out: string[] = [];
  const walk = (nodes: ReturnType<typeof resolveNavigation>): void => {
    for (const n of nodes) {
      out.push(n.qualifiedName);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

describe("Settings-Hub visibility — full boot pipeline", () => {
  test("privileged user sees the human-relevant hub; system-internal keys stay hidden", () => {
    const slice = buildNavRegistrySliceForApp(app, navMembersOf("settings"));
    const tree = resolveNavigation({
      source: slice,
      user: { id: "u-1", roles: ["TenantAdmin", "SystemAdmin"] },
    });
    const names = qualifiedNames(tree);

    expect(names).toContain("config:nav:audience-tenant");
    expect(names).toContain("config:nav:audience-user");
    // system audience surfaces ONLY because `ops` opted a human (SystemAdmin)
    // into write; its child ops-system shows, billing's system-internal key
    // (write ["system"]) stays hidden from the same admin.
    expect(names).toContain("config:nav:audience-system");
    expect(names).toContain("config:nav:ops-system");
    expect(names).not.toContain("config:nav:billing-system");

    // schema-level completeness: the hidden key IS generated (a system actor
    // could resolve it) — it's gated at resolve-time, not omitted at build-time.
    expect(navMembersOf("settings").has("config:nav:billing-system")).toBe(true);

    // hierarchy: the billing-tenant screen hangs under the tenant audience
    const tenantAudience = tree.find((n) => n.qualifiedName === "config:nav:audience-tenant");
    expect(tenantAudience?.children.map((c) => c.qualifiedName)).toContain(
      "config:nav:billing-tenant",
    );
    expect(tenantAudience?.children[0]?.screen).toBe("config:screen:billing-tenant");
  });

  test("anonymous user sees only the openToAll (user-scope) audience", () => {
    const slice = buildNavRegistrySliceForApp(app, navMembersOf("settings"));
    const tree = resolveNavigation({ source: slice }); // no user
    const names = qualifiedNames(tree);

    // digest is createUserConfig → write `all` → openToAll → visible to anyone
    expect(names).toContain("config:nav:audience-user");
    // admin/system audiences are role-gated → hidden from anonymous
    expect(names).not.toContain("config:nav:audience-tenant");
    expect(names).not.toContain("config:nav:audience-system");
  });

  test("the work workspace does NOT leak the settings hub", () => {
    const slice = buildNavRegistrySliceForApp(app, navMembersOf("main"));
    const tree = resolveNavigation({
      source: slice,
      user: { id: "u-1", roles: ["TenantAdmin", "SystemAdmin"] },
    });
    const names = qualifiedNames(tree);

    expect(names).toContain("shell:nav:home");
    expect(names.some((n) => n.startsWith("config:nav:"))).toBe(false);
  });
});
