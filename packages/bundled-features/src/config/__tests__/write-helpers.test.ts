import { describe, expect, test } from "bun:test";
import {
  ConfigScopes,
  createTenantConfig,
  SYSTEM_ROLE,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import type { KumikoError } from "@cosmicdrift/kumiko-framework/errors";
import {
  checkScopeWriteAccess,
  hasConfigAccess,
  resolvePiiSubject,
  resolveScopeIds,
  validatePattern,
  validateScope,
  validateType,
} from "../write-helpers";

// Reading the field-level code at a test boundary — KumikoError.details is
// per-error `unknown`, so one documented cast beats per-assertion narrowing.
function fieldCode(err: KumikoError | null): string | undefined {
  const d = err?.details as { fields?: ReadonlyArray<{ code: string }> } | undefined;
  return d?.fields?.[0]?.code;
}

describe("hasConfigAccess", () => {
  test('"all" grants every caller, including one with no roles', () => {
    expect(hasConfigAccess(["all"], [])).toBe(true);
    expect(hasConfigAccess(["all"], ["whatever"])).toBe(true);
  });

  test("grants when a user role intersects the access list", () => {
    expect(hasConfigAccess(["Admin", "Editor"], ["Viewer", "Editor"])).toBe(true);
  });

  test('denies when no role intersects and "all" is absent', () => {
    expect(hasConfigAccess(["Admin"], ["Viewer"])).toBe(false);
    expect(hasConfigAccess([], ["Admin"])).toBe(false);
  });
});

describe("checkScopeWriteAccess", () => {
  test("non-system scope is always allowed (no level gate)", () => {
    expect(checkScopeWriteAccess(ConfigScopes.tenant, [])).toBeNull();
    expect(checkScopeWriteAccess(ConfigScopes.user, ["Viewer"])).toBeNull();
  });

  test("system scope allows the machine actor (SYSTEM_ROLE)", () => {
    expect(checkScopeWriteAccess(ConfigScopes.system, [SYSTEM_ROLE])).toBeNull();
  });

  test("system scope allows SystemAdmin", () => {
    expect(checkScopeWriteAccess(ConfigScopes.system, ["SystemAdmin"])).toBeNull();
  });

  test("system scope denies a TenantAdmin", () => {
    const err = checkScopeWriteAccess(ConfigScopes.system, ["TenantAdmin"]);
    expect(err?.code).toBe("access_denied");
    expect(err?.i18nKey).toBe("config.errors.systemScopeWriteDenied");
  });
});

describe("validateScope", () => {
  test("a scope at or below the defined level is allowed", () => {
    // defined = user (most specific): system + tenant + user all fit under it.
    expect(validateScope(ConfigScopes.system, ConfigScopes.user, "k")).toBeNull();
    expect(validateScope(ConfigScopes.tenant, ConfigScopes.user, "k")).toBeNull();
    expect(validateScope(ConfigScopes.user, ConfigScopes.user, "k")).toBeNull();
  });

  test("requesting a more specific scope than defined is rejected", () => {
    // defined = tenant, requested = user (more specific) -> reject.
    const err = validateScope(ConfigScopes.user, ConfigScopes.tenant, "my:key");
    expect(err?.code).toBe("unprocessable");
    expect(err?.i18nKey).toBe("config.errors.invalidScope");
  });
});

describe("resolveScopeIds", () => {
  const tenant = "tenant-9" as TenantId;

  test("system scope pins SYSTEM_TENANT_ID and drops the user", () => {
    expect(resolveScopeIds(ConfigScopes.system, tenant, "user-1")).toEqual({
      tenantId: SYSTEM_TENANT_ID,
      userId: null,
    });
  });

  test("tenant scope keeps the tenant, drops the user", () => {
    expect(resolveScopeIds(ConfigScopes.tenant, tenant, "user-1")).toEqual({
      tenantId: tenant,
      userId: null,
    });
  });

  test("user scope keeps both tenant and user", () => {
    expect(resolveScopeIds(ConfigScopes.user, tenant, "user-1")).toEqual({
      tenantId: tenant,
      userId: "user-1",
    });
  });
});

describe("resolvePiiSubject (kumiko-platform#231/#459)", () => {
  const tenant = "tenant-9" as TenantId;

  test("tenant scope resolves to the tenant subject", () => {
    expect(resolvePiiSubject(ConfigScopes.tenant, tenant, null)).toEqual({
      kind: "tenant",
      tenantId: tenant,
    });
  });

  test("user scope resolves to the user subject — the row's target user, not necessarily the writer", () => {
    expect(resolvePiiSubject(ConfigScopes.user, tenant, "user-1")).toEqual({
      kind: "user",
      userId: "user-1",
    });
  });

  test("user scope without a userId throws instead of silently falling back to tenant", () => {
    expect(() => resolvePiiSubject(ConfigScopes.user, tenant, null)).toThrow(/userId is null/);
  });
});

describe("validateType", () => {
  const numberKey = createTenantConfig("number", {});
  const boolKey = createTenantConfig("boolean", {});
  const textKey = createTenantConfig("text", {});
  const selectKey = createTenantConfig("select", { options: ["a", "b"] });

  test("accepts a matching primitive for each type", () => {
    expect(validateType(5, numberKey)).toBeNull();
    expect(validateType(true, boolKey)).toBeNull();
    expect(validateType("x", textKey)).toBeNull();
    expect(validateType("a", selectKey)).toBeNull();
  });

  test("rejects a mismatching primitive with invalid_type", () => {
    const err = validateType("5", numberKey);
    expect(err?.code).toBe("validation_error");
    expect(fieldCode(err)).toBe("invalid_type");
  });

  test("select rejects a value outside its options with invalid_option", () => {
    const err = validateType("c", selectKey);
    expect(err?.code).toBe("validation_error");
    expect(fieldCode(err)).toBe("invalid_option");
  });
});

describe("validatePattern", () => {
  const textKey = createTenantConfig("text", { pattern: { regex: "^[a-z]+$" } });

  test("returns null when the value matches the pattern", () => {
    expect(validatePattern("abc", textKey)).toBeNull();
  });

  test("rejects a non-matching value with invalid_format", () => {
    const err = validatePattern("AB1", textKey);
    expect(err?.code).toBe("validation_error");
    expect(fieldCode(err)).toBe("invalid_format");
  });

  test("a malformed author regex surfaces as InternalError, not a throw", () => {
    const badKey = createTenantConfig("text", { pattern: { regex: "(" } });
    const err = validatePattern("abc", badKey);
    expect(err?.code).toBe("internal_error");
  });

  test("non-text keys (no pattern applicable) are skipped", () => {
    expect(validatePattern(5, createTenantConfig("number", {}))).toBeNull();
  });
});
