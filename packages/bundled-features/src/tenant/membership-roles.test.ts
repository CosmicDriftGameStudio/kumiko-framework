import { describe, expect, test } from "bun:test";
import { AccessDeniedError } from "@cosmicdrift/kumiko-framework/errors";
import { assertAssignableMembershipRoles, findForbiddenMembershipRole } from "./membership-roles";

describe("membership-roles", () => {
  const FORBIDDEN = ["system", "SystemAdmin", "all", "anonymous"];

  test("findForbiddenMembershipRole flags each reserved/global role", () => {
    for (const role of FORBIDDEN) {
      expect(findForbiddenMembershipRole([role])).toBe(role);
      expect(findForbiddenMembershipRole(["Admin", role, "User"])).toBe(role);
    }
  });

  test("findForbiddenMembershipRole allows legitimate tenant roles", () => {
    expect(findForbiddenMembershipRole(["Admin", "Editor", "User", "TenantAdmin"])).toBeUndefined();
    expect(findForbiddenMembershipRole([])).toBeUndefined();
  });

  test("assertAssignableMembershipRoles throws AccessDeniedError on a forbidden role", () => {
    expect(() => assertAssignableMembershipRoles(["Admin", "SystemAdmin"])).toThrow(
      AccessDeniedError,
    );
  });

  test("assertAssignableMembershipRoles passes legitimate roles", () => {
    expect(() => assertAssignableMembershipRoles(["Admin", "User"])).not.toThrow();
  });
});
