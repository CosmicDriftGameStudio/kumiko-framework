import { describe, expect, test } from "bun:test";
import { AccessDeniedError, FrameworkReasons } from "../errors/index.js";
import { mayOverrideTenant, tenantOverrideDenied } from "./cross-tenant.js";
import type { SessionUser } from "./types/index.js";

function user(roles: string[]): SessionUser {
  return { id: "u", tenantId: "t1" as SessionUser["tenantId"], roles };
}

describe("tenantOverrideDenied", () => {
  test("allows a payload without tenantIdOverride", () => {
    expect(tenantOverrideDenied(user(["TenantAdmin"]), { slug: "a" })).toBeUndefined();
    expect(
      tenantOverrideDenied(user(["TenantAdmin"]), { tenantIdOverride: undefined }),
    ).toBeUndefined();
    expect(tenantOverrideDenied(user(["TenantAdmin"]), undefined)).toBeUndefined();
  });

  test("allows a SystemAdmin to target another tenant", () => {
    expect(
      tenantOverrideDenied(user(["SystemAdmin"]), { tenantIdOverride: "other-tenant" }),
    ).toBeUndefined();
  });

  test("denies a TenantAdmin targeting another tenant", () => {
    const denied = tenantOverrideDenied(user(["TenantAdmin"]), { tenantIdOverride: "other" });
    expect(denied).toBeInstanceOf(AccessDeniedError);
    expect(denied?.code).toBe("access_denied");
    expect(denied?.details).toEqual({ reason: FrameworkReasons.tenantOverrideRequiresSystemAdmin });
  });

  test("denies an Admin too — only SystemAdmin clears the override", () => {
    expect(
      tenantOverrideDenied(user(["Admin", "TenantAdmin"]), { tenantIdOverride: "other" }),
    ).toBeInstanceOf(AccessDeniedError);
  });
});

describe("mayOverrideTenant", () => {
  test("is true for SystemAdmin only", () => {
    expect(mayOverrideTenant(user(["SystemAdmin"]))).toBe(true);
    expect(mayOverrideTenant(user(["TenantAdmin", "Admin"]))).toBe(false);
  });
});
