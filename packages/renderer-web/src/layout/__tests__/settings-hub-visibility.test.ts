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
import { qualifyScreenId } from "@cosmicdrift/kumiko-renderer";
import { buildNavRegistrySliceForApp } from "../nav-tree";

const billing = defineFeature("billing", (r) => {
  r.config({
    // tenant-home with the admin write-set (∋ SystemAdmin): cascades up to a
    // SystemAdmin-only Plattform default screen AND a tenant override screen.
    keys: { stripeKey: createTenantConfig("text", { mask: { title: "billing.stripe-key" } }) },
  });
});
// A masked SYSTEM key keeping the default ["system"] (internal-actor) write: no
// human can set it, so it must NOT generate a hub nav at all — build-time
// exclusion, not just resolve-time hiding (else it renders as an unsaveable field).
const internal = defineFeature("internal", (r) => {
  r.config({
    keys: {
      rebuildToken: createSystemConfig("text", { mask: { title: "internal.rebuild-token" } }),
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

const app = buildAppSchema(createRegistry([shell, billing, internal, notify, ops]));

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

// Mirrors the exact screen lookup KumikoScreen runs (kumiko-screen.tsx:102) —
// the REAL qualifyScreenId against the FeatureSchema's short screen ids. Proves
// a nav's screen-QN resolves to a renderable definition, not just that the ref
// string matches a convention.
function resolveScreenDef(qn: string) {
  for (const f of app.features) {
    const hit = f.screens.find((s) => qualifyScreenId(f.featureName, s.id) === qn);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function screenRefsIn(tree: ReturnType<typeof resolveNavigation>): string[] {
  const out: string[] = [];
  const walk = (nodes: ReturnType<typeof resolveNavigation>): void => {
    for (const n of nodes) {
      if (n.screen !== undefined) out.push(n.screen);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

describe("Settings-Hub visibility — full boot pipeline", () => {
  test("privileged user sees the hub incl. cascaded Plattform defaults; machine-only keys never generate a nav", () => {
    const slice = buildNavRegistrySliceForApp(app, navMembersOf("settings"));
    const tree = resolveNavigation({
      source: slice,
      user: { id: "u-1", roles: ["TenantAdmin", "SystemAdmin"] },
    });
    const names = qualifiedNames(tree);

    expect(names).toContain("config:nav:audience-tenant");
    expect(names).toContain("config:nav:audience-user");
    // system audience surfaces for `ops` (human-opted system key) AND for
    // billing's tenant key cascading up to a SystemAdmin-only Plattform default.
    expect(names).toContain("config:nav:audience-system");
    expect(names).toContain("config:nav:ops-system");
    expect(names).toContain("config:nav:billing-system");

    // the internal machine-only key (write ["system"]) generates NO nav at all —
    // build-time exclusion, so it can never render as an unsaveable field.
    expect(navMembersOf("settings").has("config:nav:internal-system")).toBe(false);
    expect(names).not.toContain("config:nav:internal-system");

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

  test("every visible leaf nav resolves to a real configEdit screen (nav → screen → definition)", () => {
    const slice = buildNavRegistrySliceForApp(app, navMembersOf("settings"));
    const tree = resolveNavigation({
      source: slice,
      user: { id: "u-1", roles: ["TenantAdmin", "SystemAdmin"] },
    });
    const refs = screenRefsIn(tree);
    expect(refs.length).toBeGreaterThan(0); // audiences have no screen; children do

    // the short screen ids in the config FeatureSchema must qualify back to the
    // exact QN the nav carries — qualifyScreenId is NOT idempotent, so a mismatch
    // would render "Screen not found" on every settings click.
    for (const qn of refs) {
      expect(resolveScreenDef(qn)?.type).toBe("configEdit");
    }
    expect(resolveScreenDef("config:screen:billing-tenant")?.type).toBe("configEdit");
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
