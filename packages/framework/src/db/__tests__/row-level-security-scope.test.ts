import { describe, expect, test } from "bun:test";
import { testTenantId } from "../../seeding/seed-users.ts";
import {
  assertNoActiveRowLevelSecurityScope,
  rowLevelSecurityScopeKey,
  runInCapturedRowLevelSecurityScope,
  runInRowLevelSecurityScope,
  runInSystemRowLevelSecurityScope,
  systemScopedRunner,
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
    runInSystemRowLevelSecurityScope("test system scope for the leak assertion", () => {
      expect(() => assertNoActiveRowLevelSecurityScope("my loop")).toThrow(/my loop/);
    });
  });

  test("names the system scope reason in the leak message", () => {
    runInSystemRowLevelSecurityScope("nightly sweep across tenants", () => {
      expect(() => assertNoActiveRowLevelSecurityScope("my loop")).toThrow(
        /system \(reason: nightly sweep across tenants\)/,
      );
    });
  });

  test("passes again when a captured empty scope is re-entered", () => {
    runInSystemRowLevelSecurityScope(
      "test system scope escaped by a captured undefined scope",
      () => {
        runInCapturedRowLevelSecurityScope(undefined, () => {
          expect(() => assertNoActiveRowLevelSecurityScope("loop")).not.toThrow();
        });
      },
    );
  });
});

describe("system scope reason", () => {
  test("rejects an empty reason", () => {
    expect(() => runInSystemRowLevelSecurityScope("", () => undefined)).toThrow(/reason/);
    expect(() => systemScopedRunner({}, "")).toThrow(/reason/);
  });

  test("rejects a whitespace-only reason", () => {
    expect(() => runInSystemRowLevelSecurityScope("   ", () => undefined)).toThrow(/reason/);
    expect(() => systemScopedRunner({}, "   ")).toThrow(/reason/);
  });
});

describe("rowLevelSecurityScopeKey", () => {
  test("distinguishes none, system and each tenant", () => {
    expect(rowLevelSecurityScopeKey(undefined)).toBe("none");
    expect(rowLevelSecurityScopeKey({ kind: "system", reason: "a" })).toBe("system");
    expect(rowLevelSecurityScopeKey({ kind: "system", reason: "b" })).toBe("system");
    expect(rowLevelSecurityScopeKey(tenantRowLevelSecurityScope(tenantA))).toBe(
      `tenant:${tenantA}`,
    );
  });
});
