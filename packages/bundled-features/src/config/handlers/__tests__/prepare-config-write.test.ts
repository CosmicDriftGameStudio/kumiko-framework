import { describe, expect, test } from "bun:test";
import {
  access,
  type ConfigKeyDefinition,
  ConfigScopes,
  createSystemConfig,
  createTenantConfig,
  createUserConfig,
  type Registry,
  type SessionUser,
  SYSTEM_ROLE,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { prepareConfigWrite, validateBounds } from "../../write-helpers";

// Minimal Registry stub — only getConfigKey is exercised by prepareConfigWrite.
function registryStub(keys: Record<string, unknown>): Registry {
  return {
    getConfigKey: (name: string) => keys[name] as never,
    // biome-ignore lint/suspicious/noExplicitAny: the other Registry methods aren't touched by prepareConfigWrite — cast documents the intent.
  } as any;
}

// Minimal user shape — prepareConfigWrite reads roles / tenantId / id.
function userStub(
  roles: readonly string[],
  tenantId = "tenant-1" as TenantId,
  id = "user-1",
): SessionUser {
  return { id, tenantId, roles } as SessionUser;
}

// Built via the public factory (same path a feature-dev takes in r.config).
// Kept const so a test that asserts `result.keyDef === TENANT_KEY_DEF`
// actually compares to the stable reference.
const TENANT_KEY_DEF = createTenantConfig("text", { write: access.roles("Admin") });

describe("prepareConfigWrite", () => {
  test("returns NotFound failure when the key is not registered", () => {
    const result = prepareConfigWrite({
      registry: registryStub({}),
      user: userStub(["Admin"]),
      key: "unknown:key",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failure.isSuccess).toBe(false);
    expect(result.failure.error.code).toBe("not_found");
    expect(result.failure.error.i18nKey).toBe("config.errors.unknownKey");
  });

  test("returns AccessDenied when the user's roles do not include the key's write roles", () => {
    const result = prepareConfigWrite({
      registry: registryStub({ "ns:config:foo": TENANT_KEY_DEF }),
      user: userStub(["ReadOnly"]),
      key: "ns:config:foo",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failure.error.code).toBe("access_denied");
  });

  test("returns AccessDenied (system-only) when the key's write access is SYSTEM_ROLE", () => {
    const systemKey = createTenantConfig("text", { write: access.system });
    const result = prepareConfigWrite({
      registry: registryStub({ "ns:config:secret": systemKey }),
      user: userStub(["SystemAdmin"]),
      key: "ns:config:secret",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failure.error.i18nKey).toBe("config.errors.systemOnly");
  });

  test("system-only key is writable by a caller that actually carries SYSTEM_ROLE", () => {
    // Post-ES escape hatch: out-of-band writes (jobs, seeds, framework-
    // internal flows) used to bypass checkWriteAccess via resolver.set.
    // The handler is the only write path now, so SYSTEM_ROLE must flow
    // through — otherwise billing/quota/session-cleanup jobs can't touch
    // system-only config anymore. Non-system roles stay blocked by the
    // test above.
    const systemKey = createTenantConfig("text", { write: access.system });
    const result = prepareConfigWrite({
      registry: registryStub({ "ns:config:secret": systemKey }),
      user: userStub([SYSTEM_ROLE]),
      key: "ns:config:secret",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.keyDef).toBe(systemKey);
  });

  test("system-only key stays blocked for Admin even when they also carry other roles", () => {
    // Regression guard: don't let "Admin + Billing" accidentally pass the
    // system-only gate because role aggregation loosens the check.
    const systemKey = createTenantConfig("text", { write: access.system });
    const result = prepareConfigWrite({
      registry: registryStub({ "ns:config:secret": systemKey }),
      user: userStub(["Admin", "Billing"]),
      key: "ns:config:secret",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failure.error.i18nKey).toBe("config.errors.systemOnly");
  });

  test("privileged key (system + SystemAdmin) is writable by a human SystemAdmin", () => {
    // The derived configEdit screen surfaces a `access.privileged`
    // (`["system","SystemAdmin"]`) key to a human SystemAdmin (e.g. Stripe
    // billing-live). The write must succeed — "system in the write-set"
    // means machine-OR-operator, not machine-only.
    const privilegedKey = createSystemConfig("boolean", { write: access.privileged });
    const result = prepareConfigWrite({
      registry: registryStub({ "ns:config:billing-live": privilegedKey }),
      user: userStub(["SystemAdmin"], SYSTEM_TENANT_ID, "sysadmin-1"),
      key: "ns:config:billing-live",
      scope: ConfigScopes.system,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.keyDef).toBe(privilegedKey);
  });

  test("privileged key stays blocked for a non-SystemAdmin human (generic denied, not system-only)", () => {
    // Security: the human half of `privileged` is SystemAdmin only — a plain
    // Admin must NOT inherit it. And the error is the generic access-denied,
    // not systemOnly (the key has a human writer, it just isn't this user).
    const privilegedKey = createSystemConfig("boolean", { write: access.privileged });
    const result = prepareConfigWrite({
      registry: registryStub({ "ns:config:billing-live": privilegedKey }),
      user: userStub(["Admin"]),
      key: "ns:config:billing-live",
      scope: ConfigScopes.system,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failure.error.code).toBe("access_denied");
    expect(result.failure.error.i18nKey).not.toBe("config.errors.systemOnly");
  });

  test("ok-path falls back to the key's declared scope when no scope is passed", () => {
    const result = prepareConfigWrite({
      registry: registryStub({ "ns:config:foo": TENANT_KEY_DEF }),
      user: userStub(["Admin"]),
      key: "ns:config:foo",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.scope).toBe(ConfigScopes.tenant);
    expect(result.tenantId).toBe("tenant-1");
    expect(result.userId).toBeNull();
    expect(result.keyDef).toBe(TENANT_KEY_DEF);
  });

  test("ok-path: scope=system maps tenantId to SYSTEM_TENANT_ID, userId to null", () => {
    // Default system-scope write role is "system" (programmatic-only) —
    // override to admin so a SystemAdmin can actually trigger this path.
    // System-scope rows carry the SYSTEM_TENANT_ID sentinel on tenant_id
    // (the projection column is NOT NULL post-ES).
    const systemKey = createSystemConfig("text", { write: access.admin });
    const result = prepareConfigWrite({
      registry: registryStub({ "ns:config:foo": systemKey }),
      user: userStub(["SystemAdmin"]),
      key: "ns:config:foo",
      scope: ConfigScopes.system,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.tenantId).toBe(SYSTEM_TENANT_ID);
    expect(result.userId).toBeNull();
  });

  test("ok-path: scope=user maps both tenantId and userId from the caller", () => {
    const userKey = createUserConfig("text");
    const result = prepareConfigWrite({
      registry: registryStub({ "ns:config:foo": userKey }),
      user: userStub(["Admin"], "t-99" as TenantId, "u-99"),
      key: "ns:config:foo",
      scope: ConfigScopes.user,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.tenantId).toBe("t-99");
    expect(result.userId).toBe("u-99");
  });

  test("TenantAdmin cannot write tenant-scoped key at system scope (platform default row)", () => {
    const tenantKey = createTenantConfig("text", { write: access.admin });
    const result = prepareConfigWrite({
      registry: registryStub({ "ns:config:smtp-host": tenantKey }),
      user: userStub(["TenantAdmin"]),
      key: "ns:config:smtp-host",
      scope: ConfigScopes.system,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failure.error.code).toBe("access_denied");
    expect(result.failure.error.i18nKey).toBe("config.errors.systemScopeWriteDenied");
  });

  test("SystemAdmin can write tenant-scoped key at system scope", () => {
    const tenantKey = createTenantConfig("text", { write: access.admin });
    const result = prepareConfigWrite({
      registry: registryStub({ "ns:config:smtp-host": tenantKey }),
      user: userStub(["SystemAdmin"], SYSTEM_TENANT_ID, "sys-1"),
      key: "ns:config:smtp-host",
      scope: ConfigScopes.system,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.scope).toBe(ConfigScopes.system);
  });
});

describe("validateBounds", () => {
  const numberKey = createTenantConfig("number", {
    default: 10,
    bounds: { min: 1, max: 100 },
  });

  test("returns null for value inside bounds", () => {
    expect(validateBounds(50, numberKey)).toBeNull();
    expect(validateBounds(1, numberKey)).toBeNull(); // boundary min
    expect(validateBounds(100, numberKey)).toBeNull(); // boundary max
  });

  test("returns out_of_bounds error when value is below min", () => {
    const err = validateBounds(0, numberKey);
    expect(err).not.toBeNull();
    expect(err?.code).toBe("validation_error");
    const details = err?.details as { fields: Array<{ code: string; params: unknown }> };
    expect(details.fields[0]?.code).toBe("out_of_bounds");
    expect(details.fields[0]?.params).toMatchObject({ value: 0, min: 1, max: 100 });
  });

  test("returns out_of_bounds error when value is above max", () => {
    const err = validateBounds(101, numberKey);
    expect(err).not.toBeNull();
    const details = err?.details as { fields: Array<{ params: unknown }> };
    expect(details.fields[0]?.params).toMatchObject({ value: 101, min: 1, max: 100 });
  });

  test("returns null when bounds declared with only min (no max)", () => {
    // Spread on a factory-produced def is the idiomatic way to tweak a
    // single field without re-stating the whole declaration.
    const minOnly: ConfigKeyDefinition = { ...numberKey, bounds: { min: 1 } };
    expect(validateBounds(9999, minOnly)).toBeNull();
    expect(validateBounds(0, minOnly)).not.toBeNull();
  });

  test("returns null when bounds declared with only max (no min)", () => {
    const maxOnly: ConfigKeyDefinition = { ...numberKey, bounds: { max: 100 } };
    expect(validateBounds(-9999, maxOnly)).toBeNull();
    expect(validateBounds(101, maxOnly)).not.toBeNull();
  });

  test("returns null for keys without bounds declared (unrestricted)", () => {
    const { bounds: _bounds, ...unrestricted } = numberKey;
    expect(validateBounds(99999, unrestricted)).toBeNull();
    expect(validateBounds(-99999, unrestricted)).toBeNull();
  });

  test("returns null for non-number key types (bounds only applies to number)", () => {
    const textKey = createTenantConfig("text");
    // Even if bounds were somehow present on a text key, non-number values
    // are unreachable here — validateType runs first and rejects them.
    expect(validateBounds("any", textKey)).toBeNull();
  });
});
