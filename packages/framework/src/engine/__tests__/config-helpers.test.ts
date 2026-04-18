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

// Static-only — these checks confirm the helpers preserve the type-tag (so
// `r.config({keys})` can propagate it into `ConfigKeyHandle<T>`). If any
// `expectTypeOf` line below stops compiling, the helper signature
// regressed to a non-generic shape and `ctx.config(handle)` will lose its
// narrow return type for affected callers.
describe("config helpers — type narrowing", () => {
  test("type tag is preserved per helper (static + runtime)", () => {
    const numberKey = createTenantConfig("number", { default: 19 });
    const boolKey = createUserConfig("boolean", { default: true });
    const textKey = createSystemConfig("text", { default: "x" });
    // Static checks: if any of these stop compiling, the helper lost its
    // generic shape and `ctx.config(handle)` returns the broad union again.
    expectTypeOf(numberKey).toEqualTypeOf<ConfigKeyDefinition<"number">>();
    expectTypeOf(boolKey).toEqualTypeOf<ConfigKeyDefinition<"boolean">>();
    expectTypeOf(textKey).toEqualTypeOf<ConfigKeyDefinition<"text">>();
    // Runtime sanity (also satisfies the fake-test guard).
    expect(numberKey.type).toBe("number");
    expect(boolKey.type).toBe("boolean");
    expect(textKey.type).toBe("text");
  });

  test("default value is narrowed to the matching primitive", () => {
    // @ts-expect-error — default must match the type tag (number, not string)
    const wrongNumber = createTenantConfig("number", { default: "nope" });
    // @ts-expect-error — default must match the type tag (boolean, not number)
    const wrongBool = createUserConfig("boolean", { default: 1 });
    // The @ts-expect-error directives above are the real assertions —
    // they fail the build if the generic widens. Touch the values so
    // unused-var lint stays quiet and the fake-test guard sees expects.
    expect(wrongNumber.type).toBe("number");
    expect(wrongBool.type).toBe("boolean");
  });
});
