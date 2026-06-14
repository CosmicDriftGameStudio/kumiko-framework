import { describe, expect, test } from "bun:test";
import { buildConfigFeatureSchema } from "../build-config-feature-schema";
import { createSystemConfig, createTenantConfig, createUserConfig } from "../config-helpers";
import { defineFeature } from "../define-feature";
import { createRegistry } from "../registry";
import type { NavDefinition } from "../types/nav";
import type { ConfigEditScreenDefinition, ScreenDefinition } from "../types/screen";

// Two features declaring masked keys across all three scopes, plus two
// exclusion probes: an UNMASKED key (internal plumbing) and a computed+masked
// key (no row to set). Built through the real createRegistry so the qualified
// names come from the real qn(toKebab(...)) path, not a hand-written stub.
const billing = defineFeature("billing", (r) => {
  r.config({
    keys: {
      stripeKey: createTenantConfig("text", { mask: { title: "billing.stripe-key", order: 1 } }),
      currency: createTenantConfig("select", {
        options: ["eur", "usd"],
        mask: { title: "billing.currency", order: 2 },
      }),
      internalFlag: createTenantConfig("boolean", {}), // no mask → excluded
      platformFee: createSystemConfig("number", { mask: { title: "billing.platform-fee" } }),
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
  if (!s || s.type !== "configEdit") throw new Error(`no configEdit screen "${id}"`);
  return s;
}

describe("buildConfigFeatureSchema — structure", () => {
  test("emits one audience parent per present scope + one child per (feature × scope)", () => {
    // scopes present: tenant (stripe/currency/from), system (platform-fee), user (digest)
    expect(navById("audience-system")).toBeDefined();
    expect(navById("audience-tenant")).toBeDefined();
    expect(navById("audience-user")).toBeDefined();

    // children: billing-tenant, notify-tenant, billing-system, notify-user
    expect(schema.screens.map((s) => s.id).sort()).toEqual([
      "billing-system",
      "billing-tenant",
      "notify-tenant",
      "notify-user",
    ]);
    expect(schema.navs).toHaveLength(7); // 3 audiences + 4 children
  });

  test("audience parents are grouping nodes (no screen) ordered system<tenant<user", () => {
    const sys = navById("audience-system");
    const ten = navById("audience-tenant");
    const usr = navById("audience-user");
    expect(sys?.screen).toBeUndefined();
    expect(sys?.parent).toBeUndefined();
    expect(ten?.label).toBe("config.settings.tenant");
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

  test("access: union of write (edit) roles; an `all`-writable group collapses to openToAll", () => {
    // billing tenant keys are createTenantConfig → write = admin roles
    const billingTenant = configScreen("billing-tenant");
    expect(billingTenant.access).toEqual({ roles: ["TenantAdmin", "Admin", "SystemAdmin"] });
    // digest is createUserConfig → write access.all (["all"]) → openToAll
    expect(configScreen("notify-user").access).toEqual({ openToAll: true });
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
    expect(out.workspace?.definition.access).toEqual({
      roles: ["TenantAdmin", "Admin", "SystemAdmin"],
    });
  });
});
