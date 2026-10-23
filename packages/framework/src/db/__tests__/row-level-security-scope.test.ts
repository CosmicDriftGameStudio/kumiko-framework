import { describe, expect, test } from "bun:test";
import { testTenantId } from "../../seeding/seed-users.ts";
import {
  assertNoActiveRowLevelSecurityScope,
  rowLevelSecurityScopeKey,
  runInCapturedRowLevelSecurityScope,
  runInRowLevelSecurityScope,
  runInSystemRowLevelSecurityScope,
  tenantRowLevelSecurityScope,
} from "../row-level-security-scope.ts";

const tenantA = testTenantId(301);

describe("assertNoActiveRowLevelSecurityScope", () => {
  test("passes outside a scope", () => {
    expect(() => assertNoActiveRowLevelSecurityScope("loop")).not.toThrow();
  });

  test("throws inside a tenant or system scope, naming what was started", () => {
    runInRowLevelSecurityScope(tenantRowLevelSecurityScope(tenantA), () => {
      expect(() => assertNoActiveRowLevelSecurityScope("my loop")).toThrow(/my loop/);
    });
    runInSystemRowLevelSecurityScope(() => {
      expect(() => assertNoActiveRowLevelSecurityScope("my loop")).toThrow(/my loop/);
    });
  });

  test("passes again when a captured empty scope is re-entered", () => {
    runInSystemRowLevelSecurityScope(() => {
      runInCapturedRowLevelSecurityScope(undefined, () => {
        expect(() => assertNoActiveRowLevelSecurityScope("loop")).not.toThrow();
      });
    });
  });
});

describe("rowLevelSecurityScopeKey", () => {
  test("distinguishes none, system and each tenant", () => {
    expect(rowLevelSecurityScopeKey(undefined)).toBe("none");
    expect(rowLevelSecurityScopeKey({ kind: "system" })).toBe("system");
    expect(rowLevelSecurityScopeKey(tenantRowLevelSecurityScope(tenantA))).toBe(
      `tenant:${tenantA}`,
    );
  });
});
