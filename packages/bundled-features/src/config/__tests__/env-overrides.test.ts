import { describe, expect, test } from "bun:test";
import {
  type ConfigKeyDefinition,
  createSystemConfig,
  createTenantConfig,
} from "@cosmicdrift/kumiko-framework/engine";
import { buildEnvConfigOverrides } from "../resolver";

// Registry stub exposing the two methods buildEnvConfigOverrides reads:
// getAllConfigKeys (iterate declared keys) + getConfigKey (validate).
function registryStub(keys: Record<string, ConfigKeyDefinition>) {
  const map: ReadonlyMap<string, ConfigKeyDefinition> = new Map(Object.entries(keys));
  return {
    getAllConfigKeys: () => map,
    getConfigKey: (key: string) => keys[key],
  };
}

describe("buildEnvConfigOverrides", () => {
  test("bridges a set env var into the override map (number, coerced)", () => {
    const reg = registryStub({
      "billing:config:timeout": createSystemConfig("number", {
        env: "BILLING_TIMEOUT",
      }),
    });
    const result = buildEnvConfigOverrides(reg, { BILLING_TIMEOUT: "42" });
    expect(result.get("billing:config:timeout")).toBe(42);
    expect(result.size).toBe(1);
  });

  test("text value passes through verbatim", () => {
    const reg = registryStub({
      "app:config:url": createSystemConfig("text", { env: "SERVICE_URL" }),
    });
    const result = buildEnvConfigOverrides(reg, { SERVICE_URL: "https://x.test" });
    expect(result.get("app:config:url")).toBe("https://x.test");
  });

  test("boolean coercion accepts true/false/1/0 case-insensitively", () => {
    const reg = registryStub({
      "a:config:flag": createSystemConfig("boolean", { env: "FLAG" }),
    });
    expect(buildEnvConfigOverrides(reg, { FLAG: "true" }).get("a:config:flag")).toBe(true);
    expect(buildEnvConfigOverrides(reg, { FLAG: "1" }).get("a:config:flag")).toBe(true);
    expect(buildEnvConfigOverrides(reg, { FLAG: "TRUE" }).get("a:config:flag")).toBe(true);
    expect(buildEnvConfigOverrides(reg, { FLAG: "false" }).get("a:config:flag")).toBe(false);
    expect(buildEnvConfigOverrides(reg, { FLAG: "0" }).get("a:config:flag")).toBe(false);
  });

  test("boolean coercion rejects a non-boolean string (fail-fast at boot)", () => {
    const reg = registryStub({
      "a:config:flag": createSystemConfig("boolean", { env: "FLAG" }),
    });
    expect(() => buildEnvConfigOverrides(reg, { FLAG: "maybe" })).toThrow(
      /expects a boolean.*got "maybe"/i,
    );
  });

  test("number coercion rejects a non-numeric string", () => {
    const reg = registryStub({
      "a:config:n": createSystemConfig("number", { env: "N" }),
    });
    expect(() => buildEnvConfigOverrides(reg, { N: "abc" })).toThrow(
      /expects a number.*got "abc"/i,
    );
  });

  test("number coercion trims whitespace", () => {
    const reg = registryStub({
      "a:config:n": createSystemConfig("number", { env: "N" }),
    });
    expect(buildEnvConfigOverrides(reg, { N: "  5 " }).get("a:config:n")).toBe(5);
  });

  test("undefined env var → key skipped (falls through to its cascade)", () => {
    const reg = registryStub({
      "a:config:x": createSystemConfig("text", { env: "MISSING" }),
    });
    const result = buildEnvConfigOverrides(reg, {});
    expect(result.size).toBe(0);
  });

  test("empty-string env var → skipped (must not clobber a declared default)", () => {
    const reg = registryStub({
      "a:config:x": createSystemConfig("text", { env: "EMPTY" }),
    });
    const result = buildEnvConfigOverrides(reg, { EMPTY: "" });
    expect(result.size).toBe(0);
  });

  test("whitespace-only env var → skipped (semantically empty, must not clobber default)", () => {
    // Number key: pre-fix `Number("   ".trim())` was 0 and finite → silently
    // resolved to 0 instead of falling through to the declared default.
    const reg = registryStub({
      "a:config:n": createSystemConfig("number", { env: "N" }),
      "a:config:x": createSystemConfig("text", { env: "X" }),
    });
    const result = buildEnvConfigOverrides(reg, { N: "   ", X: "\t\n" });
    expect(result.size).toBe(0);
  });

  test("select value is trimmed before option membership (so ` dark` resolves)", () => {
    const reg = registryStub({
      "a:config:theme": createSystemConfig("select", {
        env: "THEME",
        options: ["light", "dark"],
      }),
    });
    expect(buildEnvConfigOverrides(reg, { THEME: " dark " }).get("a:config:theme")).toBe("dark");
  });

  test("keys without an env field are ignored even if a same-named var exists", () => {
    const reg = registryStub({
      "a:config:no-env": createSystemConfig("text", {}),
    });
    // No env declared → never bridged, regardless of the environment.
    const result = buildEnvConfigOverrides(reg, {
      A_CONFIG_NO_ENV: "value",
      "a:config:no-env": "v",
    });
    expect(result.size).toBe(0);
  });

  test("select value must be one of the declared options", () => {
    const reg = registryStub({
      "a:config:theme": createSystemConfig("select", {
        env: "THEME",
        options: ["light", "dark"],
      }),
    });
    expect(buildEnvConfigOverrides(reg, { THEME: "dark" }).get("a:config:theme")).toBe("dark");
    expect(() => buildEnvConfigOverrides(reg, { THEME: "purple" })).toThrow(/not in options/i);
  });

  test("number env value outside bounds fails (validateAppOverrides gate)", () => {
    const reg = registryStub({
      "a:config:n": createSystemConfig("number", {
        env: "N",
        bounds: { min: 1, max: 100 },
      }),
    });
    expect(() => buildEnvConfigOverrides(reg, { N: "999" })).toThrow(/above bounds\.max/i);
  });

  test("bridges only the env-declaring keys out of a mixed registry", () => {
    const reg = registryStub({
      "a:config:bridged": createSystemConfig("number", { env: "BRIDGED" }),
      "a:config:plain": createTenantConfig("text", {}),
      "a:config:unset": createSystemConfig("text", { env: "UNSET" }),
    });
    const result = buildEnvConfigOverrides(reg, { BRIDGED: "7" });
    expect(result.size).toBe(1);
    expect(result.get("a:config:bridged")).toBe(7);
  });
});
