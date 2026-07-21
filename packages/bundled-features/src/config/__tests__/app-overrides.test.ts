import { describe, expect, test } from "bun:test";
import { createTenantConfig, createUserConfig } from "@cosmicdrift/kumiko-framework/engine";
import { validateAppOverrides } from "../resolver";

// Minimal registry stub — validateAppOverrides only reads getConfigKey.
// Cast keeps the test isolated from the rest of the Registry surface.
function registryStub(keys: Record<string, unknown>) {
  return {
    getConfigKey: (key: string) => keys[key] as never,
  };
}

describe("validateAppOverrides", () => {
  test("accepts a typed override that matches an existing key", () => {
    const reg = registryStub({
      "files:config:max-size": createTenantConfig("number"),
    });
    const validated = validateAppOverrides(reg, {
      "files:config:max-size": 50,
    });
    expect(validated.get("files:config:max-size")).toBe(50);
    expect(validated.size).toBe(1);
  });

  test("throws on unknown key", () => {
    const reg = registryStub({});
    expect(() =>
      validateAppOverrides(reg, {
        "missing:config:x": 1,
      }),
    ).toThrow(/unknown config key.*missing:config:x/i);
  });

  test("throws on type mismatch — number key, string value", () => {
    const reg = registryStub({
      "a:config:x": createTenantConfig("number"),
    });
    expect(() =>
      validateAppOverrides(reg, {
        "a:config:x": "not-a-number",
      }),
    ).toThrow(/expected number, got string/i);
  });

  test("throws on type mismatch — boolean key, number value", () => {
    const reg = registryStub({
      "a:config:flag": createTenantConfig("boolean"),
    });
    expect(() =>
      validateAppOverrides(reg, {
        "a:config:flag": 1,
      }),
    ).toThrow(/expected boolean, got number/i);
  });

  test("select key — accepts value in options, rejects anything else", () => {
    const reg = registryStub({
      "a:config:theme": createTenantConfig("select", { options: ["light", "dark", "auto"] }),
    });
    // ok
    expect(() => validateAppOverrides(reg, { "a:config:theme": "dark" })).not.toThrow();
    // not in options
    expect(() => validateAppOverrides(reg, { "a:config:theme": "purple" })).toThrow(
      /not in options/i,
    );
  });

  test("throws on bounds violation — below min", () => {
    const reg = registryStub({
      "a:config:n": createTenantConfig("number", { bounds: { min: 1, max: 100 } }),
    });
    expect(() => validateAppOverrides(reg, { "a:config:n": 0 })).toThrow(/below bounds\.min/i);
  });

  test("throws on bounds violation — above max", () => {
    const reg = registryStub({
      "a:config:n": createTenantConfig("number", { bounds: { min: 1, max: 100 } }),
    });
    expect(() => validateAppOverrides(reg, { "a:config:n": 101 })).toThrow(/above bounds\.max/i);
  });

  test("passes multiple overrides at once and preserves all", () => {
    const reg = registryStub({
      "a:config:n": createTenantConfig("number"),
      "a:config:s": createTenantConfig("text"),
      "a:config:b": createUserConfig("boolean"),
    });
    const result = validateAppOverrides(reg, {
      "a:config:n": 42,
      "a:config:s": "hello",
      "a:config:b": true,
    });
    expect(result.size).toBe(3);
    expect(result.get("a:config:n")).toBe(42);
    expect(result.get("a:config:s")).toBe("hello");
    expect(result.get("a:config:b")).toBe(true);
  });

  test("empty overrides map passes through without validation cost", () => {
    const reg = registryStub({});
    const result = validateAppOverrides(reg, {});
    expect(result.size).toBe(0);
  });

  test("rejects override for a computed key — plan-logic may not be silently bypassed", () => {
    const reg = registryStub({
      "plan:config:quota": createTenantConfig("number", {
        default: 10,
        computed: async () => 100,
      }),
    });
    expect(() =>
      validateAppOverrides(reg, {
        "plan:config:quota": 999,
      }),
    ).toThrow(/computed resolver.*app-overrides would silently bypass/i);
  });

  test("throws on type mismatch — text key, number value", () => {
    const reg = registryStub({
      "a:config:s": createTenantConfig("text"),
    });
    expect(() =>
      validateAppOverrides(reg, {
        "a:config:s": 42,
      }),
    ).toThrow(/expected string, got number/i);
  });
});

