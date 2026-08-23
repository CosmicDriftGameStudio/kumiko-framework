import { describe, expect, test } from "bun:test";
import { findForbiddenRoleAssignment } from "../role-assignment";

describe("role assignment guard", () => {
  test("rejects roles above the actor's highest role", () => {
    expect(findForbiddenRoleAssignment(["Admin"], ["User", "TenantAdmin"])).toBe("TenantAdmin");
    expect(findForbiddenRoleAssignment(["TenantAdmin"], ["SystemAdmin"])).toBe("SystemAdmin");
  });

  test("allows equal or lower roles, including self-updates", () => {
    expect(findForbiddenRoleAssignment(["Admin"], ["User", "Admin"])).toBeUndefined();
    expect(findForbiddenRoleAssignment(["TenantAdmin"], ["User", "Admin"])).toBeUndefined();
    expect(findForbiddenRoleAssignment(["Admin"], ["Admin"])).toBeUndefined();
  });

  test("treats unknown roles as the lowest rank", () => {
    expect(findForbiddenRoleAssignment(["User"], ["Custom"])).toBeUndefined();
  });
});
