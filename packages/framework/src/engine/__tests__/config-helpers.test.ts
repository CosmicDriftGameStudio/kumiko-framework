import { describe, expect, expectTypeOf, test } from "vitest";
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
    expect(access.admin).toEqual(["Admin", "SystemAdmin"]);
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
    expect(key.access.write).toEqual(["Admin", "SystemAdmin"]);
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
    expect(key.access.read).toEqual(["Admin", "SystemAdmin"]);
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
    // @ts-expect-error — bounds only valid for "number"
    const selectKey = createSystemConfig("select", {
      options: ["a", "b"],
      bounds: { min: 1 },
    });
    expect(textKey.type).toBe("text");
    expect(boolKey.type).toBe("boolean");
    expect(selectKey.type).toBe("select");
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
    // @ts-expect-error — number tag, string return
    const wrongNumber = createTenantConfig("number", {
      computed: async () => "not-a-number",
    });
    // @ts-expect-error — boolean tag, number return
    const wrongBool = createUserConfig("boolean", {
      computed: async () => 1,
    });
    expect(wrongNumber.type).toBe("number");
    expect(wrongBool.type).toBe("boolean");
  });
});
