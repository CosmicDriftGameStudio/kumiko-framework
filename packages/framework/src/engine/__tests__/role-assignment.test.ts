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
    expect(findForbiddenRoleAssignment(["SystemAdmin"], ["SystemAdmin"])).toBeUndefined();
  });

  test("rejects unknown roles (fail-closed)", () => {
    expect(findForbiddenRoleAssignment(["User"], ["Custom"])).toBe("Custom");
    expect(findForbiddenRoleAssignment(["SystemAdmin"], ["Custom"])).toBe("Custom");
  });

  test("rejects assignment if actor has no roles or only unknown roles", () => {
    expect(findForbiddenRoleAssignment([], ["User"])).toBe("User");
    expect(findForbiddenRoleAssignment(["UnknownRole"], ["User"])).toBe("User");
  });

  test("rejects modifying target user with higher existing role", () => {
    expect(findForbiddenRoleAssignment(["Admin"], ["User"], ["SystemAdmin"])).toBe("SystemAdmin");
    expect(findForbiddenRoleAssignment(["TenantAdmin"], ["User"], ["TenantAdmin"])).toBeUndefined();
  });
});
