import { describe, expect, test } from "bun:test";
import { buildConfigFeatureSchema } from "../build-config-feature-schema";
import {
  access,
  createSystemConfig,
  createTenantConfig,
  createUserConfig,
} from "../config-helpers";
import { defineFeature } from "../define-feature";
import { createRegistry } from "../registry";
import type { NavDefinition } from "../types/nav";
import type { ConfigEditScreenDefinition, ScreenDefinition } from "../types/screen";

// Two features declaring masked keys across all three scopes. Probes:
//  - apiKey: a SYSTEM-home key with a human writer (SystemAdmin) — the real
//    subscription-stripe shape; renders on the Plattform screen.
//  - platformFee: a SYSTEM-home key that keeps the default `["system"]` write
//    (machine-only) — must NOT surface in the human hub anywhere.
//  - internalFlag: UNMASKED (internal plumbing) — excluded.
//  - derived: computed+masked (no row to set) — excluded.
// stripeKey/currency/fromAddress are TENANT-home with the admin write-set
// (∋ SystemAdmin), so they yield BOTH a SystemAdmin-only Plattform screen (set
// the platform default) AND a tenant screen with the full admin set (override).
// Built through the real createRegistry so the qualified names come from the
// real qn(toKebab(...)) path, not a hand-written stub.
const billing = defineFeature("billing", (r) => {
  r.config({
    keys: {
      apiKey: createSystemConfig("text", {
        write: access.systemAdmin,
        mask: { title: "billing.api-key" },
      }),
      stripeKey: createTenantConfig("text", { mask: { title: "billing.stripe-key", order: 1 } }),
      currency: createTenantConfig("select", {
        options: ["eur", "usd"],
        mask: { title: "billing.currency", order: 2 },
      }),
      internalFlag: createTenantConfig("boolean", {}), // no mask → excluded
      platformFee: createSystemConfig("number", { mask: { title: "billing.platform-fee" } }), // machine-only write → excluded
      derived: createTenantConfig("number", {
        computed: async () => 5,
        mask: { title: "billing.derived" }, // masked BUT computed → excluded
      }),
    },
  });
});

const notify = defineFeature("notify", (r) => {
  r.config({
    keys: {
      fromAddress: createTenantConfig("text", { mask: { title: "notify.from" } }),
      digest: createUserConfig("boolean", { mask: { title: "notify.digest" } }),
    },
  });
});

const schema = buildConfigFeatureSchema(createRegistry([billing, notify]));

function navById(id: string): NavDefinition | undefined {
  return schema.navs.find((n) => n.id === id);
}
function configScreen(id: string): ConfigEditScreenDefinition {
  const s: ScreenDefinition | undefined = schema.screens.find((x) => x.id === id);
  if (s?.type !== "configEdit") throw new Error(`no configEdit screen "${id}"`);
  return s;
}

describe("buildConfigFeatureSchema — structure", () => {
  test("emits one audience parent per present scope + one child per (feature × scope)", () => {
    // scopes present: system (api-key + tenant keys elevated), tenant, user
    expect(navById("audience-system")).toBeDefined();
    expect(navById("audience-tenant")).toBeDefined();
    expect(navById("audience-user")).toBeDefined();

    // tenant keys (stripe/currency/from) span system too → notify-system exists.
    expect(schema.screens.map((s) => s.id).sort()).toEqual([
      "billing-system",
      "billing-tenant",
      "notify-system",
      "notify-tenant",
      "notify-user",
    ]);
    expect(schema.navs).toHaveLength(8); // 3 audiences + 5 children
  });

  test("audience parents are grouping nodes (no screen) ordered system<tenant<user", () => {
    const sys = navById("audience-system");
    const ten = navById("audience-tenant");
    const usr = navById("audience-user");
    expect(sys?.screen).toBeUndefined();
    expect(sys?.parent).toBeUndefined();
    expect(ten?.label).toBe("config.settings.tenant");
    expect(sys?.icon).toBe("shield");
    expect(ten?.icon).toBe("building");
    expect(usr?.icon).toBe("user");
    expect((sys?.order ?? 0) < (ten?.order ?? 0) && (ten?.order ?? 0) < (usr?.order ?? 0)).toBe(
      true,
    );
  });

  test("child nav points to its screen under the right audience parent", () => {
    const child = navById("billing-tenant");
    expect(child?.parent).toBe("audience-tenant");
    expect(child?.screen).toBe("billing-tenant");
    expect(child?.label).toBe("billing.settings");
  });

  test("screen carries qualified configKeys, derived field types, and mask.title as fieldLabels", () => {
    const s = configScreen("billing-tenant");
    expect(s.scope).toBe("tenant");
    expect(s.configKeys).toEqual({
      "stripe-key": "billing:config:stripe-key",
      currency: "billing:config:currency",
    });
    expect(s.fields["stripe-key"]?.type).toBe("text");
    expect(s.fields["currency"]?.type).toBe("select");
    expect((s.fields["currency"] as { options?: readonly string[] }).options).toEqual([
      "eur",
      "usd",
    ]);
    // mask.title flows to fieldLabels — the per-field label override the
    // Settings-Hub relies on (no __config-edit__ convention duplication).
    expect(s.fieldLabels).toEqual({
      "stripe-key": "billing.stripe-key",
      currency: "billing.currency",
    });
  });

  test("fields are ordered by mask.order; section title is the feature group key", () => {
    const s = configScreen("billing-tenant");
    expect(s.layout.sections).toHaveLength(1);
    const section = s.layout.sections[0];
    expect(section && "title" in section ? section.title : undefined).toBe("billing.settings");
    expect(section && "fields" in section ? section.fields : undefined).toEqual([
      "stripe-key",
      "currency",
    ]);
  });

  test("excludes unmasked keys and computed keys", () => {
    const s = configScreen("billing-tenant");
    // internal-flag has no mask, derived is computed → neither appears anywhere
    expect(Object.keys(s.configKeys)).not.toContain("internal-flag");
    expect(Object.keys(s.configKeys)).not.toContain("derived");
    const allConfigKeyValues = schema.screens.flatMap((x) =>
      x.type === "configEdit" ? Object.values(x.configKeys) : [],
    );
    expect(allConfigKeyValues).not.toContain("billing:config:internal-flag");
    expect(allConfigKeyValues).not.toContain("billing:config:derived");
  });
});

describe("buildConfigFeatureSchema — per-role cascade (system > tenant > user)", () => {
  test("a tenant-home key yields a SystemAdmin-only Plattform screen AND a full-admin tenant screen", () => {
    // The cascade env→system→tenant lets SystemAdmin set the platform DEFAULT a
    // tenant inherits; the tenant admin OVERRIDES at the tenant row. The two
    // screens MUST gate differently — else a tenant admin could edit the
    // platform default (the security crux of "smtp = sysadmin > admin").
    const sysScreen = configScreen("notify-system");
    expect(sysScreen.scope).toBe("system");
    expect(sysScreen.configKeys).toEqual({ "from-address": "notify:config:from-address" });
    expect(sysScreen.access).toEqual({ roles: ["SystemAdmin"] });
    // TenantAdmin/Admin are NOT on the platform-default screen.
    const sysAccess = sysScreen.access;
    const sysRoles = sysAccess && "roles" in sysAccess ? sysAccess.roles : [];
    expect(sysRoles).not.toContain("TenantAdmin");
    expect(sysRoles).not.toContain("Admin");

    const tenScreen = configScreen("notify-tenant");
    expect(tenScreen.scope).toBe("tenant");
    expect(tenScreen.configKeys).toEqual({ "from-address": "notify:config:from-address" });
    expect(tenScreen.access).toEqual({ roles: ["TenantAdmin", "Admin", "SystemAdmin"] });

    // audience-system is likewise SystemAdmin-only (parent gate union).
    expect(navById("audience-system")?.access).toEqual({ roles: ["SystemAdmin"] });
  });

  test("the Plattform screen co-groups a feature's system-home key with its elevated tenant keys", () => {
    // billing-system carries api-key (system home, write SystemAdmin) AND the
    // elevated tenant keys stripe-key/currency — all writable by SystemAdmin.
    const s = configScreen("billing-system");
    expect(Object.keys(s.configKeys).sort()).toEqual(["api-key", "currency", "stripe-key"]);
    expect(s.access).toEqual({ roles: ["SystemAdmin"] });
  });

  test("a machine-only system key (write defaults to ['system']) never reaches the human hub", () => {
    // platform-fee keeps the default system write — no human can set it, so it
    // must not render on any screen (would otherwise look editable but reject).
    const allConfigKeyValues = schema.screens.flatMap((x) =>
      x.type === "configEdit" ? Object.values(x.configKeys) : [],
    );
    expect(allConfigKeyValues).not.toContain("billing:config:platform-fee");
    expect(schema.screens.some((s) => s.id === "billing-system" && "scope" in s)).toBe(true);
  });

  test("a user-home `all`-writable key stays at the user scope only — no broader default screen", () => {
    // digest is write `all`; no elevated role names it (all ∩ elevated = ∅), so
    // it gets no broader (tenant/system) default screen, only the personal one.
    expect(configScreen("notify-user").scope).toBe("user");
    const digestPlacements = schema.screens
      .flatMap((x) => (x.type === "configEdit" ? Object.values(x.configKeys) : []))
      .filter((v) => v === "notify:config:digest");
    expect(digestPlacements).toHaveLength(1);
  });
});

describe("buildConfigFeatureSchema — machine-role does not leak into screen access (#406/2)", () => {
  // A mixed write-set (machine "system" + human "SystemAdmin") only arises via
  // an explicit write:-override (no preset produces the mix). The screen must
  // gate on the human role only — "system" is not carried by a real user and
  // leaking it makes the gate inconsistent with the hardening goal.
  const mixedWrite = defineFeature("mixed", (r) => {
    r.config({
      keys: {
        apiKey: createSystemConfig("text", {
          write: [...access.system, ...access.systemAdmin],
          mask: { title: "mixed.api-key" },
        }),
      },
    });
  });

  test("a key with write ['system','SystemAdmin'] yields a SystemAdmin-only screen (no 'system')", () => {
    const s = buildConfigFeatureSchema(createRegistry([mixedWrite]));
    const screen = s.screens.find((x) => x.id === "mixed-system");
    if (screen?.type !== "configEdit") throw new Error("no mixed-system configEdit screen");
    expect(screen.access).toEqual({ roles: ["SystemAdmin"] });
    const roles = screen.access && "roles" in screen.access ? screen.access.roles : [];
    expect(roles).not.toContain("system");
  });
});

describe("buildConfigFeatureSchema — access + workspace", () => {
  test("home-scope screens union write (edit) roles; an `all`-writable group collapses to openToAll", () => {
    // billing tenant keys are createTenantConfig → write = admin roles
    expect(configScreen("billing-tenant").access).toEqual({
      roles: ["TenantAdmin", "Admin", "SystemAdmin"],
    });
    // digest is createUserConfig → write access.all (["all"]) → openToAll
    expect(configScreen("notify-user").access).toEqual({ openToAll: true });
  });

  test("a screen mixing an openToAll key with role-restricted keys collapses to openToAll", () => {
    // unionAccessRules short-circuits: one openToAll writer opens the whole gate,
    // even next to role-restricted keys.
    const mixedWrite = defineFeature("mixedwrite", (r) => {
      r.config({
        keys: {
          open: createTenantConfig("text", { write: access.all, mask: { title: "mw.open" } }),
          gated: createTenantConfig("text", { mask: { title: "mw.gated" } }), // default admin write
        },
      });
    });
    const out = buildConfigFeatureSchema(createRegistry([mixedWrite]));
    const screen = out.screens.find((s) => s.id === "mixedwrite-tenant");
    if (screen?.type !== "configEdit")
      throw new Error('expected configEdit screen "mixedwrite-tenant"');
    expect(screen.access).toEqual({ openToAll: true });
    expect(out.navs.find((n) => n.id === "audience-tenant")?.access).toEqual({ openToAll: true });
  });

  test("openToAll collapse holds regardless of key declaration order (516/2)", () => {
    // The test above only ever puts the openToAll key first, so
    // unionAccessRules's short-circuit (`if ("openToAll" in rule) return`)
    // never actually has to walk past a role-restricted rule to prove it —
    // `gated` here comes FIRST so a hypothetical short-circuit-on-first-only
    // implementation would fail this one even though it passed the other.
    const mixedWriteReversed = defineFeature("mixedwritereversed", (r) => {
      r.config({
        keys: {
          gated: createTenantConfig("text", { mask: { title: "mwr.gated" } }), // default admin write
          open: createTenantConfig("text", { write: access.all, mask: { title: "mwr.open" } }),
        },
      });
    });
    const out = buildConfigFeatureSchema(createRegistry([mixedWriteReversed]));
    const screen = out.screens.find((s) => s.id === "mixedwritereversed-tenant");
    if (screen?.type !== "configEdit")
      throw new Error('expected configEdit screen "mixedwritereversed-tenant"');
    expect(screen.access).toEqual({ openToAll: true });
  });

  test("returns empty (no workspace) when no key opts into the hub via mask", () => {
    const plain = defineFeature("plain", (r) => {
      r.config({ keys: { secret: createSystemConfig("text", {}) } });
    });
    const empty = buildConfigFeatureSchema(createRegistry([plain]));
    expect(empty.screens).toHaveLength(0);
    expect(empty.navs).toHaveLength(0);
    expect(empty.workspace).toBeUndefined();
  });

  test("returns empty (no workspace) when every masked key is machine-only", () => {
    // masked BUT default ["system"] write — no human writer at any scope, so the
    // hub has nothing to show and no (empty) settings switcher is emitted.
    const internalOnly = defineFeature("internal", (r) => {
      r.config({ keys: { token: createSystemConfig("text", { mask: { title: "i.token" } }) } });
    });
    const empty = buildConfigFeatureSchema(createRegistry([internalOnly]));
    expect(empty.screens).toHaveLength(0);
    expect(empty.navs).toHaveLength(0);
    expect(empty.workspace).toBeUndefined();
  });

  test("emits a settings workspace with qualified navMembers (config:nav:*) over every generated nav", () => {
    const ws = schema.workspace;
    expect(ws).toBeDefined();
    expect(ws?.definition.id).toBe("settings");
    expect(ws?.definition.label).toBe("config.settings.title");
    expect(ws?.definition.default).toBeUndefined(); // never the login default
    // every generated nav (parents + children) qualified under the config namespace
    expect(ws?.navMembers).toEqual(schema.navs.map((n) => `config:nav:${n.id}`).sort());
  });

  test("workspace access is the union of write roles across all hub keys", () => {
    // billing/notify tenant keys → admin write; notify-user digest → write all.
    // Any `all`-writable key collapses the whole switcher entry to openToAll.
    expect(schema.workspace?.definition.access).toEqual({ openToAll: true });
  });

  test("workspace access stays role-gated when no hub key is world-writable", () => {
    const adminOnly = defineFeature("adminonly", (r) => {
      r.config({ keys: { apiKey: createTenantConfig("text", { mask: { title: "a.key" } }) } });
    });
    const out = buildConfigFeatureSchema(createRegistry([adminOnly]));
    const acc = out.workspace?.definition.access;
    expect(acc && "roles" in acc ? [...acc.roles].sort() : acc).toEqual([
      "Admin",
      "SystemAdmin",
      "TenantAdmin",
    ]);
  });

  test("workspace access excludes the machine-only 'system' role when a machine key is masked", () => {
    // A masked machine-only key (write defaults to ["system"]) is excluded from
    // every human nav — its "system" role must not leak into the switcher gate
    // just because it sits in the hub next to a human-writable key (#406/1).
    const mixed = defineFeature("mixedhub", (r) => {
      r.config({
        keys: {
          label: createTenantConfig("text", { mask: { title: "m.label" } }),
          internalFlag: createSystemConfig("boolean", { mask: { title: "m.flag" } }),
        },
      });
    });
    const out = buildConfigFeatureSchema(createRegistry([mixed]));
    const acc = out.workspace?.definition.access;
    expect(acc).toBeDefined();
    const roles = acc && "roles" in acc ? acc.roles : [];
    expect(roles).not.toContain("system");
    expect([...roles].sort()).toEqual(["Admin", "SystemAdmin", "TenantAdmin"]);
  });
});

describe("buildConfigFeatureSchema — cross-feature group", () => {
  test("two features sharing a group bucket under one screen/nav per scope, not two", () => {
    const timeTracking = defineFeature("time-tracking", (r) => {
      r.config({
        keys: {
          enabled: createTenantConfig("boolean", {
            group: "bmc-settings",
            mask: { title: "bmc.time-tracking-enabled" },
          }),
        },
      });
    });
    const autoProtocol = defineFeature("auto-protocol", (r) => {
      r.config({
        keys: {
          enabled: createTenantConfig("boolean", {
            group: "bmc-settings",
            mask: { title: "bmc.auto-protocol-enabled" },
          }),
        },
      });
    });

    const out = buildConfigFeatureSchema(createRegistry([timeTracking, autoProtocol]));
    expect(out.screens.filter((s) => s.id === "bmc-settings-tenant")).toHaveLength(1);
    expect(out.navs.filter((n) => n.id === "bmc-settings-tenant")).toHaveLength(1);

    const screen = out.screens.find((s) => s.id === "bmc-settings-tenant");
    if (screen?.type !== "configEdit") throw new Error("expected configEdit screen");
    // Neither feature owns the group name, so field ids are prefixed by the
    // owning feature to stay unique — the whole point of the collision guard.
    expect(screen.configKeys).toEqual({
      "time-tracking-enabled": "time-tracking:config:enabled",
      "auto-protocol-enabled": "auto-protocol:config:enabled",
    });
  });

  test("same group + colliding owner-prefixed field id throws instead of silently overwriting", () => {
    // "a-b" owner + shortKey "x" and "a" owner + shortKey "b-x" both produce
    // the prefixed field id "a-b-x" — the exact clobbering hazard the
    // owner-prefix scheme must catch, not just avoid in the common case.
    const ab = defineFeature("a-b", (r) => {
      r.config({
        keys: { x: createTenantConfig("boolean", { group: "shared", mask: { title: "ab.x" } }) },
      });
    });
    const a = defineFeature("a", (r) => {
      r.config({
        keys: {
          bX: createTenantConfig("boolean", { group: "shared", mask: { title: "a.b-x" } }),
        },
      });
    });
    expect(() => buildConfigFeatureSchema(createRegistry([ab, a]))).toThrow(
      /both resolve to field id "a-b-x"/,
    );
  });

  test("group unset → behavior unchanged (buckets under the owning feature, plain shortKey)", () => {
    const feature = defineFeature("ungrouped", (r) => {
      r.config({
        keys: { flag: createTenantConfig("boolean", { mask: { title: "u.flag" } }) },
      });
    });
    const out = buildConfigFeatureSchema(createRegistry([feature]));
    const screen = out.screens.find((s) => s.id === "ungrouped-tenant");
    if (screen?.type !== "configEdit") throw new Error("expected configEdit screen");
    expect(screen.configKeys).toEqual({ flag: "ungrouped:config:flag" });
  });

  test("invalid (non-kebab) group value throws at schema-build time", () => {
    const feature = defineFeature("badgroup", (r) => {
      r.config({
        keys: {
          flag: createTenantConfig("boolean", {
            group: "Not Kebab!",
            mask: { title: "bg.flag" },
          }),
        },
      });
    });
    expect(() => buildConfigFeatureSchema(createRegistry([feature]))).toThrow(/kebab-case/);
  });
});
