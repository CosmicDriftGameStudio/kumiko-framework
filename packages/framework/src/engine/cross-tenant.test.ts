import { describe, expect, test } from "bun:test";
import { AccessDeniedError } from "../errors";
import { crossTenantOverrideDenied } from "./cross-tenant";
import type { SessionUser } from "./types";

const KEY = "feature.errors.tenantOverrideRequiresSystemAdmin";

function user(roles: string[]): SessionUser {
  return { id: "u", tenantId: "t1" as SessionUser["tenantId"], roles };
}

describe("crossTenantOverrideDenied", () => {
  test("allows when no override is requested", () => {
    expect(crossTenantOverrideDenied(user(["TenantAdmin"]), undefined, KEY)).toBeUndefined();
  });

  test("allows a SystemAdmin to target another tenant", () => {
    expect(crossTenantOverrideDenied(user(["SystemAdmin"]), "other-tenant", KEY)).toBeUndefined();
  });

  test("denies a TenantAdmin targeting another tenant", () => {
    const denied = crossTenantOverrideDenied(user(["TenantAdmin"]), "other-tenant", KEY);
    expect(denied).toBeInstanceOf(AccessDeniedError);
    expect(denied?.code).toBe("access_denied");
  });

  test("denies an Admin too — only SystemAdmin clears the override", () => {
    expect(crossTenantOverrideDenied(user(["Admin", "TenantAdmin"]), "other", KEY)).toBeInstanceOf(
      AccessDeniedError,
    );
  });
});
