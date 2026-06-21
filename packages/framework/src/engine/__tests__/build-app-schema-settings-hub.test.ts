import { describe, expect, spyOn, test } from "bun:test";
import { validateBoot } from "../boot-validator";
import { buildAppSchema, findNonJsonSafePath } from "../build-app-schema";
import { SETTINGS_HUB_FEATURE, SETTINGS_HUB_WORKSPACE } from "../build-config-feature-schema";
import { access, createSystemConfig, createTenantConfig } from "../config-helpers";
import { defineFeature } from "../define-feature";
import { createRegistry } from "../registry";

// A feature that opts config keys into the Settings-Hub via `mask`. platformFee
// is a system-home key with a human writer (SystemAdmin); stripeKey is tenant-
// home but its admin write-set cascades it up to the Plattform screen too.
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

// A config key WITHOUT mask — internal plumbing, must not surface a hub.
const plain = defineFeature("plain", (r) => {
  r.config({ keys: { secret: createSystemConfig("text", {}) } });
});

function configFeature(app: ReturnType<typeof buildAppSchema>) {
  return app.features.filter((f) => f.featureName === SETTINGS_HUB_FEATURE);
}

describe("buildAppSchema — Settings-Hub wiring", () => {
  test("app WITHOUT workspaces: hub screens/navs appear, app stays in no-filter mode (no flip)", () => {
    const app = buildAppSchema(createRegistry([billing]));

    // The decisive non-flip assertion: a workspace-less app must NOT gain
    // workspaces — else the renderer flips into filter-mode and drops navs.
    expect(app.workspaces).toBeUndefined();

    const config = configFeature(app);
    expect(config).toHaveLength(1); // exactly one FeatureSchema, no duplicate
    const hub = config[0];
    // billing has a tenant + a system masked key → two configEdit screens
    expect(hub?.screens.map((s) => s.id).sort()).toEqual(["billing-system", "billing-tenant"]);
    // audience parents (system, tenant) + the two children
    expect(hub?.navs?.map((n) => n.id).sort()).toEqual([
      "audience-system",
      "audience-tenant",
      "billing-system",
      "billing-tenant",
    ]);
  });

  test("app WITH workspaces: original workspaces kept + synthetic settings workspace appended", () => {
    const shell = defineFeature("shell", (r) => {
      r.screen({ id: "home", type: "entityList", entity: "thing", columns: ["label"] });
      r.entity("thing", { fields: { label: { type: "text" } } });
      r.nav({ id: "home", label: "Home", screen: "home" });
      r.workspace({ id: "main", label: "Main", nav: ["shell:nav:home"] });
    });

    const app = buildAppSchema(createRegistry([shell, billing]));

    expect(app.workspaces).toBeDefined();
    const ids = app.workspaces?.map((w) => w.definition.id).sort();
    expect(ids).toEqual(["main", SETTINGS_HUB_WORKSPACE]);

    const settings = app.workspaces?.find((w) => w.definition.id === SETTINGS_HUB_WORKSPACE);
    // navMembers are qualified QNs under the config namespace
    expect(settings?.navMembers).toContain("config:nav:audience-tenant");
    expect(settings?.navMembers).toContain("config:nav:billing-tenant");
    // and the original workspace's members are untouched
    const main = app.workspaces?.find((w) => w.definition.id === "main");
    expect(main?.navMembers).toEqual(["shell:nav:home"]);
  });

  test("find-or-create: merges into an existing `config` feature instead of duplicating it", () => {
    // Stand-in for the config bundled-feature: a real feature named "config"
    // that already owns a screen/nav. The hub must fold INTO it.
    const configBundled = defineFeature(SETTINGS_HUB_FEATURE, (r) => {
      r.entity("config-value", { fields: { value: { type: "text" } } });
      r.screen({ id: "existing", type: "entityList", entity: "config-value", columns: ["value"] });
      r.nav({ id: "existing", label: "Existing", screen: "existing" });
    });

    const app = buildAppSchema(createRegistry([configBundled, billing]));

    const config = configFeature(app);
    expect(config).toHaveLength(1); // NOT two FeatureSchemas with name "config"
    const hub = config[0];
    // the pre-existing screen survives alongside the generated hub screens
    expect(hub?.screens.map((s) => s.id)).toContain("existing");
    expect(hub?.screens.map((s) => s.id)).toContain("billing-tenant");
    expect(hub?.navs?.map((n) => n.id)).toContain("existing");
    expect(hub?.navs?.map((n) => n.id)).toContain("audience-tenant");
  });

  test("non-breaking: config keys WITHOUT mask leave the schema hub-free", () => {
    const app = buildAppSchema(createRegistry([plain]));
    expect(app.workspaces).toBeUndefined();
    const config = configFeature(app);
    // the plain feature isn't named "config", so no config FeatureSchema is
    // synthesized at all — the app is byte-identical to the pre-hub world.
    expect(config).toHaveLength(0);
  });

  test("generated hub output stays JSON-safe (factory fields are pure literals)", () => {
    const app = buildAppSchema(shellWith(billing));
    expect(findNonJsonSafePath(app, "app")).toBeNull();
  });
});

// Helper: an app that has a workspace AND the masked billing keys, so the
// JSON-safety walk covers the synthetic workspace + configEdit screens too.
function shellWith(masked: ReturnType<typeof defineFeature>) {
  const shell = defineFeature("shell", (r) => {
    r.entity("thing", { fields: { label: { type: "text" } } });
    r.screen({ id: "home", type: "entityList", entity: "thing", columns: ["label"] });
    r.nav({ id: "home", label: "Home", screen: "home" });
    r.workspace({ id: "main", label: "Main", nav: ["shell:nav:home"] });
  });
  return createRegistry([shell, masked]);
}

// A shell whose workspaces place the generated audience parents inline by
// referencing config:nav:audience-<scope> directly (the app-driven placement
// the renderer-side slice then expands with the audience's children).
function placingShell(...audienceScopes: string[]) {
  return defineFeature("shell", (r) => {
    r.entity("thing", { fields: { label: { type: "text" } } });
    r.screen({ id: "home", type: "entityList", entity: "thing", columns: ["label"] });
    r.nav({ id: "home", label: "Home", screen: "home" });
    r.workspace({
      id: "main",
      label: "Main",
      nav: ["shell:nav:home", ...audienceScopes.map((s) => `config:nav:audience-${s}`)],
    });
  });
}

function workspaceNavs(app: ReturnType<typeof buildAppSchema>, id: string): readonly string[] {
  const ws = app.workspaces?.find((w) => w.definition.id === id);
  if (ws === undefined) throw new Error(`no workspace "${id}"`);
  return ws.navMembers;
}

describe("buildAppSchema — Settings-Hub inline placement", () => {
  test("a workspace referencing an audience parent gets that audience's children expanded in", () => {
    const app = buildAppSchema(createRegistry([placingShell("system"), billing]));
    const main = workspaceNavs(app, "main");
    // the app listed only the parent; the framework expands the child screen-nav
    // so the slice doesn't drop it.
    expect(main).toContain("config:nav:audience-system");
    expect(main).toContain("config:nav:billing-system");
    // the app's own nav is untouched
    expect(main).toContain("shell:nav:home");
  });

  test("placing every audience suppresses the standalone settings switcher entirely", () => {
    // billing spans system + tenant → place both → no separate Einstellungen tab.
    const app = buildAppSchema(createRegistry([placingShell("system", "tenant"), billing]));
    expect(app.workspaces?.map((w) => w.definition.id).sort()).toEqual(["main"]);
    const main = workspaceNavs(app, "main");
    expect(main).toContain("config:nav:billing-system");
    expect(main).toContain("config:nav:billing-tenant");
  });

  test("partial placement keeps un-placed audiences in the standalone tab (nothing vanishes)", () => {
    // place only system → the tenant audience must still be reachable via the
    // standalone settings workspace, never silently dropped.
    const app = buildAppSchema(createRegistry([placingShell("system"), billing]));
    const settings = workspaceNavs(app, SETTINGS_HUB_WORKSPACE);
    expect(settings).toContain("config:nav:audience-tenant");
    expect(settings).toContain("config:nav:billing-tenant");
    // the placed (system) audience is NOT duplicated into the standalone tab
    expect(settings).not.toContain("config:nav:audience-system");
    expect(settings).not.toContain("config:nav:billing-system");
  });

  test("an app that places NO audience keeps the standalone tab whole (backward compatible)", () => {
    const app = buildAppSchema(shellWith(billing));
    const settings = workspaceNavs(app, SETTINGS_HUB_WORKSPACE);
    expect(settings).toContain("config:nav:audience-system");
    expect(settings).toContain("config:nav:audience-tenant");
  });

  test("boot validation exempts the generated audience nav QNs but still catches typos", () => {
    const ok = defineFeature("ok", (r) => {
      r.config({ keys: { fee: createSystemConfig("number", { mask: { title: "ok.fee" } }) } });
      r.workspace({ id: "w", label: "W", nav: ["config:nav:audience-system"] });
    });
    expect(() => validateBoot([ok])).not.toThrow();

    const typo = defineFeature("typo", (r) => {
      r.config({ keys: { fee: createSystemConfig("number", { mask: { title: "t.fee" } }) } });
      r.workspace({ id: "w", label: "W", nav: ["config:nav:audience-systemm"] });
    });
    expect(() => validateBoot([typo])).toThrow(/references nav "config:nav:audience-systemm"/);
  });
});

describe("buildAppSchema — dangling audience-ref dev-warning (#408/3)", () => {
  // billing registers only system+tenant keys → audience-user is NEVER
  // generated. A workspace referencing config:nav:audience-user still boots
  // (the boot-validator exempts the audience QNs), but the entry renders
  // invisibly — the dev must see a warning, not silently nothing.
  function warnsFor(scopes: string[]): string[] {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      buildAppSchema(createRegistry([placingShell(...scopes), billing]));
      return warn.mock.calls.map((c) => String(c[0]));
    } finally {
      warn.mockRestore();
      if (prevEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = prevEnv;
      }
    }
  }

  test("referencing a never-generated audience warns (dangling-ref)", () => {
    const messages = warnsFor(["user"]);
    expect(
      messages.some((m) => m.includes("config:nav:audience-user") && m.includes("nie generiert")),
    ).toBe(true);
  });

  test("referencing a generated audience does NOT trigger the dangling warning", () => {
    // audience-tenant IS generated (billing has tenant keys) → kein dangling.
    const messages = warnsFor(["tenant"]);
    expect(messages.some((m) => m.includes("nie generiert"))).toBe(false);
  });

  test("authoring warnings are suppressed under NODE_ENV=test — no CI-log noise (#408/1)", () => {
    // bun:test setzt NODE_ENV=test; eine un-platzierte Audience (tenant bleibt
    // bei placingShell("system") übrig) darf KEIN console.warn ins Log spülen.
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      buildAppSchema(createRegistry([placingShell("system"), billing]));
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
