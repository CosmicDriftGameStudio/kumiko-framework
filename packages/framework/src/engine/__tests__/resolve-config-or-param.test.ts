import { describe, expect, test, vi } from "vitest";
import { ConfigScopes } from "../constants";
import { resolveConfigOrParam } from "../resolve-config-or-param";
import type {
  ConfigKeyDefinition,
  ConfigKeyHandle,
  ConfigKeyType,
  ConfigValue,
  Registry,
} from "../types";

type KeyEntry = ConfigKeyDefinition<ConfigKeyType>;

// Minimal ctx stub: just enough for resolveConfigOrParam. The real ctx has
// a ConfigAccessor that hits the DB; here we pass a mock that returns a
// deterministic fallback value so we can distinguish "param used" from
// "config fallback used" in assertions.
function makeCtx(entries: Record<string, { def: KeyEntry; fallback: unknown }>) {
  const registry = {
    getConfigKey: (key: string) => entries[key]?.def,
  } as unknown as Registry;

  const configFn = vi.fn(async <T extends ConfigKeyType>(handle: ConfigKeyHandle<T>) => {
    return entries[handle.name]?.fallback as ConfigValue<T> | undefined;
  });

  return {
    ctx: { config: configFn, registry },
    configFn,
  };
}

function handleFor<T extends ConfigKeyType>(name: string, type: T): ConfigKeyHandle<T> {
  return { name, type };
}

describe("resolveConfigOrParam — number with bounds", () => {
  const numberDef: KeyEntry = {
    type: "number",
    scope: ConfigScopes.tenant,
    access: { read: ["all"], write: ["Admin"] },
    default: 10,
    bounds: { min: 1, max: 100 },
  };

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
    const noBoundsDef: KeyEntry = { ...numberDef, bounds: undefined };
    const { ctx } = makeCtx({ k: { def: noBoundsDef, fallback: 10 } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), 999_999)).toBe(999_999);
    expect(await resolveConfigOrParam(ctx, handleFor("k", "number"), -999)).toBe(-999);
  });
});

describe("resolveConfigOrParam — boolean", () => {
  const boolDef: KeyEntry = {
    type: "boolean",
    scope: ConfigScopes.user,
    access: { read: ["all"], write: ["all"] },
    default: false,
  };

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
  const selectDef: KeyEntry = {
    type: "select",
    scope: ConfigScopes.tenant,
    access: { read: ["all"], write: ["Admin"] },
    default: "light",
    options: ["light", "dark", "auto"],
  };

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

describe("resolveConfigOrParam — text", () => {
  const textDef: KeyEntry = {
    type: "text",
    scope: ConfigScopes.tenant,
    access: { read: ["all"], write: ["Admin"] },
    default: "default",
  };

  test("param string passed through", async () => {
    const { ctx } = makeCtx({ k: { def: textDef, fallback: "default" } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "text"), "custom")).toBe("custom");
  });

  test("undefined → config fallback", async () => {
    const { ctx } = makeCtx({ k: { def: textDef, fallback: "default" } });
    expect(await resolveConfigOrParam(ctx, handleFor("k", "text"), undefined)).toBe("default");
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
