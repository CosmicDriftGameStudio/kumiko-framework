import { describe, expect, expectTypeOf, test } from "bun:test";
import {
  access,
  createSystemConfig,
  createTenantConfig,
  createUserConfig,
} from "../config-helpers";
import type { ConfigKeyDefinition } from "../types";

describe("access presets", () => {
  test("access.all", () => {
    expect(access.all).toEqual(["all"]);
  });

  test("access.admin", () => {
    expect(access.admin).toEqual(["TenantAdmin", "Admin", "SystemAdmin"]);
  });

  test("access.systemAdmin", () => {
    expect(access.systemAdmin).toEqual(["SystemAdmin"]);
  });

  test("access.system", () => {
    expect(access.system).toEqual(["system"]);
  });

  test("access.privileged covers framework auth + SystemAdmin", () => {
    expect(access.privileged).toEqual(["system", "SystemAdmin"]);
  });

  test("access.authenticated covers any signed-in user role (no system)", () => {
    expect(access.authenticated).toEqual(["User", "Admin", "SystemAdmin"]);
  });

  test("access.roles() creates custom role list", () => {
    expect(access.roles("Billing", "Accounting")).toEqual(["Billing", "Accounting"]);
  });
});

describe("createTenantConfig", () => {
  test("defaults: admin writes, all reads", () => {
    const key = createTenantConfig("text");
    expect(key.scope).toBe("tenant");
    expect(key.access.write).toEqual(["TenantAdmin", "Admin", "SystemAdmin"]);
    expect(key.access.read).toEqual(["all"]);
  });

  test("custom roles override defaults", () => {
    const key = createTenantConfig("text", {
      write: access.roles("Billing"),
      read: access.roles("Admin", "Billing"),
    });
    expect(key.access.write).toEqual(["Billing"]);
    expect(key.access.read).toEqual(["Admin", "Billing"]);
  });

  test("encrypted flag", () => {
    const key = createTenantConfig("text", { encrypted: true });
    expect(key.encrypted).toBe(true);
  });

  test("with default value", () => {
    const key = createTenantConfig("number", { default: 42 });
    expect(key.default).toBe(42);
    expect(key.type).toBe("number");
  });

  test("select with options", () => {
    const key = createTenantConfig("select", { options: ["de", "en", "fr"] });
    expect(key.options).toEqual(["de", "en", "fr"]);
  });
});

describe("createSystemConfig", () => {
  test("defaults: system writes, admin reads", () => {
    const key = createSystemConfig("number");
    expect(key.scope).toBe("system");
    expect(key.access.write).toEqual(["system"]);
    expect(key.access.read).toEqual(["TenantAdmin", "Admin", "SystemAdmin"]);
  });

  test("with default value", () => {
    const key = createSystemConfig("number", { default: 50 });
    expect(key.default).toBe(50);
  });
});

describe("createUserConfig", () => {
  test("defaults: all writes, all reads", () => {
    const key = createUserConfig("boolean");
    expect(key.scope).toBe("user");
    expect(key.access.write).toEqual(["all"]);
    expect(key.access.read).toEqual(["all"]);
  });

  test("with default value", () => {
    const key = createUserConfig("boolean", { default: true });
    expect(key.default).toBe(true);
  });
});

describe("config helpers — provisioning metadata (env / inheritedToTenant / backing)", () => {
  test("env name is carried; absent → field absent", () => {
    const bridged = createSystemConfig("text", { env: "STRIPE_SECRET_KEY" });
    expect(bridged.env).toBe("STRIPE_SECRET_KEY");
    expect(createSystemConfig("text").env).toBeUndefined();
  });

  test("inheritedToTenant:false attaches; default/true is omitted", () => {
    const hidden = createSystemConfig("text", { inheritedToTenant: false });
    expect(hidden.inheritedToTenant).toBe(false);

    expect(createSystemConfig("text").inheritedToTenant).toBeUndefined();
    expect(
      createSystemConfig("text", { inheritedToTenant: true }).inheritedToTenant,
    ).toBeUndefined();
  });

  test("backing:secrets is carried; default config is omitted", () => {
    const secrets = createSystemConfig("text", { backing: "secrets" });
    expect(secrets.backing).toBe("secrets");
    expect(createSystemConfig("text").backing).toBeUndefined();
    expect(createSystemConfig("text", { backing: "config" }).backing).toBeUndefined();
  });

  test("provisioning fields live on every scope factory — no factory switch to gain them", () => {
    // The whole point of folding them in: a tenant or user key gains an env
    // binding (or redaction) by adding a field, never by switching factory.
    expect(createTenantConfig("text", { env: "TENANT_VAR" }).env).toBe("TENANT_VAR");
    expect(createUserConfig("boolean", { inheritedToTenant: false }).inheritedToTenant).toBe(false);
  });

  test("Stripe-shape: system + masked + hidden-from-tenant + env + secrets in one call", () => {
    const key = createSystemConfig("text", {
      env: "STRIPE_SECRET_KEY",
      encrypted: true,
      inheritedToTenant: false,
      backing: "secrets",
      required: true,
    });
    expect(key).toMatchObject({
      type: "text",
      scope: "system",
      encrypted: true,
      inheritedToTenant: false,
      env: "STRIPE_SECRET_KEY",
      backing: "secrets",
      required: true,
    });
  });

  test("@ts-expect-error: backing only accepts the ConfigBacking union", () => {
    // @ts-expect-error — "vault" is not a ConfigBacking ("config" | "secrets")
    const key = createSystemConfig("text", { backing: "vault" });
    expect(key.type).toBe("text");
  });
});

// expectTypeOf + @ts-expect-error are the real assertions — they fail the
// build if the helper generic widens. The expect() lines exist so the
// fake-test guard sees runtime asserts and lint stays quiet on unused vars.
describe("config helpers — type narrowing", () => {
  test("type tag is preserved per helper", () => {
    const numberKey = createTenantConfig("number", { default: 19 });
    const boolKey = createUserConfig("boolean", { default: true });
    const textKey = createSystemConfig("text", { default: "x" });
    expectTypeOf(numberKey).toEqualTypeOf<ConfigKeyDefinition<"number">>();
    expectTypeOf(boolKey).toEqualTypeOf<ConfigKeyDefinition<"boolean">>();
    expectTypeOf(textKey).toEqualTypeOf<ConfigKeyDefinition<"text">>();
    expect(numberKey.type).toBe("number");
    expect(boolKey.type).toBe("boolean");
    expect(textKey.type).toBe("text");
  });

  test("default value must match the type-tag primitive", () => {
    // @ts-expect-error — number tag, string default
    const wrongNumber = createTenantConfig("number", { default: "nope" });
    // @ts-expect-error — boolean tag, number default
    const wrongBool = createUserConfig("boolean", { default: 1 });
    expect(wrongNumber.type).toBe("number");
    expect(wrongBool.type).toBe("boolean");
  });
});

describe("config helpers — bounds (number only)", () => {
  test("bounds attach to the definition when provided", () => {
    const key = createTenantConfig("number", {
      default: 10,
      bounds: { min: 1, max: 100 },
    });
    expect(key.bounds).toEqual({ min: 1, max: 100 });
  });

  test("bounds can be partial (min only)", () => {
    const key = createTenantConfig("number", {
      default: 10,
      bounds: { min: 0 },
    });
    expect(key.bounds).toEqual({ min: 0 });
  });

  test("bounds can be partial (max only)", () => {
    const key = createSystemConfig("number", {
      default: 50,
      bounds: { max: 1000 },
    });
    expect(key.bounds).toEqual({ max: 1000 });
  });

  test("no bounds → bounds field absent", () => {
    const key = createTenantConfig("number", { default: 10 });
    expect(key.bounds).toBeUndefined();
  });

  test("@ts-expect-error: bounds on non-number types is rejected", () => {
    // @ts-expect-error — bounds only valid for "number"
    const textKey = createTenantConfig("text", { bounds: { min: 1 } });
    // @ts-expect-error — bounds only valid for "number"
    const boolKey = createUserConfig("boolean", { bounds: { max: 1 } });
    const selectKey = createSystemConfig("select", {
      options: ["a", "b"],
      // @ts-expect-error — bounds only valid for "number"
      bounds: { min: 1 },
    });
    expect(textKey.type).toBe("text");
    expect(boolKey.type).toBe("boolean");
    expect(selectKey.type).toBe("select");
  });
});

describe("config helpers — allowPerRequest opt-in", () => {
  test("allowPerRequest=true attaches to the definition", () => {
    const key = createTenantConfig("number", {
      default: 10,
      allowPerRequest: true,
    });
    expect(key.allowPerRequest).toBe(true);
  });

  test("allowPerRequest=false is omitted (same shape as absent)", () => {
    const key = createTenantConfig("number", {
      default: 10,
      allowPerRequest: false,
    });
    expect(key.allowPerRequest).toBeUndefined();
  });

  test("no allowPerRequest → field absent (deny-by-default)", () => {
    const key = createTenantConfig("number", { default: 10 });
    expect(key.allowPerRequest).toBeUndefined();
  });

  test("@ts-expect-error: allowPerRequest on text is rejected at compile time", () => {
    // @ts-expect-error — text keys can't opt in to per-request overrides
    const textKey = createTenantConfig("text", { allowPerRequest: true });
    expect(textKey.type).toBe("text");
  });
});

describe("config helpers — group (Settings-Hub namespace override)", () => {
  test("group is carried when set", () => {
    const key = createTenantConfig("boolean", { group: "tenant-settings" });
    expect(key.group).toBe("tenant-settings");
  });

  test("no group → field absent (defaults to the owning feature)", () => {
    expect(createTenantConfig("boolean").group).toBeUndefined();
  });

  test("group is available on every scope factory", () => {
    expect(createSystemConfig("text", { group: "shared" }).group).toBe("shared");
    expect(createUserConfig("text", { group: "shared" }).group).toBe("shared");
  });
});

describe("config helpers — computed (plan-based / derived values)", () => {
  test("computed function attaches to the definition and returns the typed value", async () => {
    const key = createTenantConfig("number", {
      default: 10,
      computed: async () => 200,
    });
    expect(typeof key.computed).toBe("function");
    if (!key.computed) throw new Error("unreachable");
    const value = await key.computed({
      tenantId: "00000000-0000-4000-8000-000000000001" as never,
      userId: "u-1",
      db: {} as never,
    });
    expect(value).toBe(200);
  });

  test("no computed → field absent on the definition", () => {
    const key = createTenantConfig("number", { default: 10 });
    expect(key.computed).toBeUndefined();
  });

  test("@ts-expect-error: computed return must match the type-tag", () => {
    const wrongNumber = createTenantConfig("number", {
      // @ts-expect-error — number tag, string return
      computed: async () => "not-a-number",
    });
    const wrongBool = createUserConfig("boolean", {
      // @ts-expect-error — boolean tag, number return
      computed: async () => 1,
    });
    expect(wrongNumber.type).toBe("number");
    expect(wrongBool.type).toBe("boolean");
  });
});
