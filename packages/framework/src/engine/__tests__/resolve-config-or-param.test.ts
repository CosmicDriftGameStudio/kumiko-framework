import { describe, expect, test } from "bun:test";
import { createTenantConfig, createUserConfig } from "../config-helpers";
import { type ClampInfo, resolveConfigOrParam } from "../resolve-config-or-param";
import type {
  ConfigAccessor,
  ConfigKeyDefinition,
  ConfigKeyHandle,
  ConfigKeyType,
  ConfigValue,
  Registry,
} from "../types";

// Tests build keydefs through the public factories (createTenantConfig etc.)
// — identical to what a feature-dev writes in r.config. Hand-rolled
// ConfigKeyDefinition literals are only used where we deliberately bypass
// the factory's compile-time guards (defence-in-depth tests).
type KeyEntry = ConfigKeyDefinition<ConfigKeyType>;

// Minimal ctx stub: just enough for resolveConfigOrParam. The real ctx has
// a ConfigAccessor that hits the DB; here we pass a mock that returns a
// deterministic fallback value so we can distinguish "param used" from
// "config fallback used" in assertions.
function makeCtx(entries: Record<string, { def: KeyEntry; fallback: unknown }>) {
  const registry = {
    getConfigKey: (key: string) => entries[key]?.def,
  } as unknown as Registry;

  const configFn = mock(async <T extends ConfigKeyType>(handle: ConfigKeyHandle<T>) => {
    return entries[handle.name]?.fallback as ConfigValue<T> | undefined;
  });

  // Cast to the overloaded ConfigAccessor — the test only ever calls the
  // handle-overload, so the missing string-overload on the mock is moot.
  // The double-cast keeps the runtime mock untouched while satisfying the
  // structural check.
  const config = configFn as unknown as ConfigAccessor;

  return {
    ctx: { config, registry },
    configFn,
  };
}

function handleFor<T extends ConfigKeyType>(name: string, type: T): ConfigKeyHandle<T> {
  return { name, type };
}

describe("resolveConfigOrParam — number with bounds", () => {
  const numberDef = createTenantConfig("number", {
    default: 10,
    bounds: { min: 1, max: 100 },
    allowPerRequest: true,
  });

  test("paramValue inside bounds returns param as-is", async () => {
    const { ctx } = makeCtx({ k: { def: numberDef, fallback: 10 } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), 50)).toBe(50);
  });

  test("paramValue below min is clamped up to min", async () => {
    const { ctx } = makeCtx({ k: { def: numberDef, fallback: 10 } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), -5)).toBe(1);
  });

  test("paramValue above max is clamped down to max", async () => {
    const { ctx } = makeCtx({ k: { def: numberDef, fallback: 10 } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), 9999)).toBe(100);
  });

  test("string numbers are coerced and clamped", async () => {
    const { ctx } = makeCtx({ k: { def: numberDef, fallback: 10 } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), "42")).toBe(42);
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), "9999")).toBe(100);
  });

  test("NaN / Infinity / non-numeric strings fall back to config", async () => {
    const { ctx, configFn } = makeCtx({ k: { def: numberDef, fallback: 10 } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), "abc")).toBe(10);
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), NaN)).toBe(10);
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), Infinity)).toBe(10);
    expect(configFn).toHaveBeenCalled();
  });

  test("undefined / null / empty string → config fallback", async () => {
    const { ctx, configFn } = makeCtx({ k: { def: numberDef, fallback: 10 } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), undefined)).toBe(10);
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), null)).toBe(10);
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), "")).toBe(10);
    expect(configFn).toHaveBeenCalledTimes(3);
  });

  test("number without bounds is passed through unchanged", async () => {
    const { bounds: _bounds, ...noBoundsDef } = numberDef;
    const { ctx } = makeCtx({ k: { def: noBoundsDef, fallback: 10 } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), 999_999)).toBe(999_999);
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), -999)).toBe(-999);
  });
});

describe("resolveConfigOrParam — boolean", () => {
  const boolDef = createUserConfig("boolean", {
    default: false,
    allowPerRequest: true,
  });

  test("boolean passed through", async () => {
    const { ctx } = makeCtx({ k: { def: boolDef, fallback: false } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "boolean"), true)).toBe(true);
    expect(await resolveConfigOrParam(ctx, handleFor("k", "boolean"), false)).toBe(false);
  });

  test("'true'/'1' parsed as true, anything else as false", async () => {
    const { ctx } = makeCtx({ k: { def: boolDef, fallback: false } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "boolean"), "true")).toBe(true);
    expect(await resolveConfigOrParam(ctx, handleFor("k", "boolean"), "TRUE")).toBe(true);
    expect(await resolveConfigOrParam(ctx, handleFor("k", "boolean"), "1")).toBe(true);
    expect(await resolveConfigOrParam(ctx, handleFor("k", "boolean"), "false")).toBe(false);
    expect(await resolveConfigOrParam(ctx, handleFor("k", "boolean"), "nonsense")).toBe(false);
  });

  test("undefined → config fallback", async () => {
    const { ctx } = makeCtx({ k: { def: boolDef, fallback: true } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "boolean"), undefined)).toBe(true);
  });
});

describe("resolveConfigOrParam — select (option whitelist)", () => {
  const selectDef = createTenantConfig("select", {
    default: "light",
    options: ["light", "dark", "auto"],
    allowPerRequest: true,
  });

  test("valid option returns the option", async () => {
    const { ctx } = makeCtx({ k: { def: selectDef, fallback: "light" } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "select"), "dark")).toBe("dark");
  });

  test("invalid option falls back to configured value", async () => {
    const { ctx, configFn } = makeCtx({ k: { def: selectDef, fallback: "light" } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "select"), "purple")).toBe("light");
    expect(configFn).toHaveBeenCalled();
  });
});

describe("resolveConfigOrParam — text (defence-in-depth lock)", () => {
  // Two layers protect text keys:
  //   1. allowPerRequest can never be true for text (type-level + boot-check).
  //   2. Even if someone smuggles in allowPerRequest=true via hand-rolled
  //      config, the resolver's text-case throws as a second barrier.

  const textDefNoOptIn = createTenantConfig("text", { default: "default" });

  test("undefined paramValue returns config value (normal read still works)", async () => {
    const { ctx } = makeCtx({ k: { def: textDefNoOptIn, fallback: "default" } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "text"), undefined)).toBe("default");
    expect(await resolveConfigOrParam(ctx, handleFor("k", "text"), null)).toBe("default");
    expect(await resolveConfigOrParam(ctx, handleFor("k", "text"), "")).toBe("default");
  });

  test("paramValue on text key without opt-in throws (layer 1: allowPerRequest gate)", async () => {
    const { ctx } = makeCtx({ k: { def: textDefNoOptIn, fallback: "default" } });
    await expect(resolveConfigOrParam(ctx, handleFor("k", "text"), "custom")).rejects.toThrow(
      /per-request override not enabled/i,
    );
  });

  test("hand-rolled text key with allowPerRequest=true still throws (layer 2: text-specific lock)", async () => {
    // Type-level guard rejects this declaration; boot-validator would too.
    // But if someone force-casts past both, the resolver must still refuse.
    // Hand-rolled spread is the only way to get this shape past the
    // factory's compile-time never-type for allowPerRequest on text.
    const forcedTextDef: KeyEntry = { ...textDefNoOptIn, allowPerRequest: true };
    const { ctx } = makeCtx({ k: { def: forcedTextDef, fallback: "default" } });
    await expect(resolveConfigOrParam(ctx, handleFor("k", "text"), "custom")).rejects.toThrow(
      /not allowed for type="text"/i,
    );
  });

  test("attack-like strings are always rejected (documents threat model)", async () => {
    const { ctx } = makeCtx({ k: { def: textDefNoOptIn, fallback: "default" } });
    await expect(
      resolveConfigOrParam(ctx, handleFor("k", "text"), "<script>alert(1)</script>"),
    ).rejects.toThrow();
    await expect(
      resolveConfigOrParam(ctx, handleFor("k", "text"), "'; DROP TABLE users; --"),
    ).rejects.toThrow();
  });
});

describe("resolveConfigOrParam — allowPerRequest opt-in (deny-by-default)", () => {
  // No allowPerRequest → any paramValue should be rejected.
  const numberDefNoOptIn = createTenantConfig("number", {
    default: 10,
    bounds: { min: 1, max: 100 },
  });

  test("paramValue on a key WITHOUT allowPerRequest throws", async () => {
    const { ctx } = makeCtx({ k: { def: numberDefNoOptIn, fallback: 10 } });
    await expect(resolveConfigOrParam(ctx, handleFor("k", "number"), 42)).rejects.toThrow(
      /per-request override not enabled.*allowPerRequest/i,
    );
  });

  test("undefined paramValue is OK even without opt-in (normal config read still works)", async () => {
    const { ctx } = makeCtx({ k: { def: numberDefNoOptIn, fallback: 10 } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), undefined)).toBe(10);
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), null)).toBe(10);
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), "")).toBe(10);
  });

  test("allowPerRequest=false throws (explicit denial, same as omitted)", async () => {
    // Spread on the factory-produced def to flip the flag explicitly — the
    // factory's own guard (omits allowPerRequest when not true) means we
    // can't express "false" through the factory alone.
    const explicitDeny: KeyEntry = { ...numberDefNoOptIn, allowPerRequest: false };
    const { ctx } = makeCtx({ k: { def: explicitDeny, fallback: 10 } });
    await expect(resolveConfigOrParam(ctx, handleFor("k", "number"), 42)).rejects.toThrow(
      /per-request override not enabled/i,
    );
  });

  test("error message includes the key name so debugging is quick", async () => {
    const { ctx } = makeCtx({ "orders:config:some-key": { def: numberDefNoOptIn, fallback: 10 } });
    await expect(
      resolveConfigOrParam(ctx, handleFor("orders:config:some-key", "number"), 42),
    ).rejects.toThrow(/orders:config:some-key/);
  });
});

describe("resolveConfigOrParam — edge cases", () => {
  test("handle whose key is missing from registry falls back to ctx.config", async () => {
    // Registry returns undefined for this handle — helper gracefully degrades.
    const { ctx, configFn } = makeCtx({});
    configFn.mockResolvedValue(42 as never);
    expect(await resolveConfigOrParam(ctx, handleFor("missing", "number"), 999)).toBe(42);
    expect(configFn).toHaveBeenCalled();
  });
});

describe("resolveConfigOrParam — onClamp audit hook", () => {
  const boundedDef = createTenantConfig("number", {
    default: 10,
    bounds: { min: 1, max: 100 },
    allowPerRequest: true,
  });

  test("onClamp fires when value is clamped down to max", async () => {
    const { ctx } = makeCtx({ k: { def: boundedDef, fallback: 10 } });
    const clamps: ClampInfo[] = [];
    const result = await resolveConfigOrParam(ctx, handleFor("k", "number"), 9999, {
      onClamp: (info) => clamps.push(info),
    });
    expect(result).toBe(100);
    expect(clamps).toHaveLength(1);
    expect(clamps[0]).toMatchObject({
      key: "k",
      original: 9999,
      clamped: 100,
      min: 1,
      max: 100,
    });
  });

  test("onClamp fires when value is clamped up to min", async () => {
    const { ctx } = makeCtx({ k: { def: boundedDef, fallback: 10 } });
    const clamps: ClampInfo[] = [];
    await resolveConfigOrParam(ctx, handleFor("k", "number"), -5, {
      onClamp: (info) => clamps.push(info),
    });
    expect(clamps[0]).toMatchObject({ original: -5, clamped: 1 });
  });

  test("onClamp does NOT fire when value is within bounds", async () => {
    const { ctx } = makeCtx({ k: { def: boundedDef, fallback: 10 } });
    const onClamp = mock();
    await resolveConfigOrParam(ctx, handleFor("k", "number"), 50, { onClamp });
    expect(onClamp).not.toHaveBeenCalled();
  });

  test("onClamp does NOT fire on exact boundary values", async () => {
    const { ctx } = makeCtx({ k: { def: boundedDef, fallback: 10 } });
    const onClamp = mock();
    await resolveConfigOrParam(ctx, handleFor("k", "number"), 1, { onClamp });
    await resolveConfigOrParam(ctx, handleFor("k", "number"), 100, { onClamp });
    expect(onClamp).not.toHaveBeenCalled();
  });

  test("onClamp does NOT fire when value is coerced to NaN (no clamp happens, config fallback used)", async () => {
    const { ctx } = makeCtx({ k: { def: boundedDef, fallback: 10 } });
    const onClamp = mock();
    await resolveConfigOrParam(ctx, handleFor("k", "number"), "abc", { onClamp });
    expect(onClamp).not.toHaveBeenCalled();
  });

  test("absent options → no callback infrastructure, still works (backward-compat with callers pre-audit)", async () => {
    const { ctx } = makeCtx({ k: { def: boundedDef, fallback: 10 } });
    // Three variants: no 4th arg, empty options, options without onClamp.
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), 9999)).toBe(100);
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), 9999, {})).toBe(100);
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), 9999, {})).toBe(100);
  });

  test("clamp info omits min when bounds has only max (and vice versa)", async () => {
    // Spread on factory def to get a max-only bounds.
    const maxOnly: KeyEntry = { ...boundedDef, bounds: { max: 100 } };
    const { ctx } = makeCtx({ k: { def: maxOnly, fallback: 10 } });
    const clamps: ClampInfo[] = [];
    await resolveConfigOrParam(ctx, handleFor("k", "number"), 9999, {
      onClamp: (info) => clamps.push(info),
    });
    expect(clamps[0]).toMatchObject({ clamped: 100, max: 100 });
    expect(clamps[0]).not.toHaveProperty("min");
  });
});
