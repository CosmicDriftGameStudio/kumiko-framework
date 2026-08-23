import { describe, expect, test } from "bun:test";
import { findForbiddenRoleAssignment } from "../role-assignment";

describe("role assignment guard", () => {
  test("rejects roles above the actor's highest role", () => {
    expect(findForbiddenRoleAssignment(["Admin"], ["User", "TenantAdmin"])).toBe("TenantAdmin");
    expect(findForbiddenRoleAssignment(["TenantAdmin"], ["SystemAdmin"])).toBe("SystemAdmin");
  });

  test("allows equal or lower roles, including self-updates", () => {
    expect(findForbiddenRoleAssignment(["Admin"], ["User", "Admin"])).toBeUndefined();
    expect(findForbiddenRoleAssignment(["Admin"], ["Editor"])).toBeUndefined();
    expect(findForbiddenRoleAssignment(["Editor"], ["User", "Editor"])).toBeUndefined();
    expect(findForbiddenRoleAssignment(["TenantAdmin"], ["User", "Admin"])).toBeUndefined();
    expect(findForbiddenRoleAssignment(["Admin"], ["Admin"])).toBeUndefined();
    expect(findForbiddenRoleAssignment(["SystemAdmin"], ["SystemAdmin"])).toBeUndefined();
  });

  test("rejects Editor above User, Admin above Editor", () => {
    expect(findForbiddenRoleAssignment(["User"], ["Editor"])).toBe("Editor");
    expect(findForbiddenRoleAssignment(["Editor"], ["Admin"])).toBe("Admin");
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

  test("allows modifying target that currently holds an unranked app role", () => {
    // Editor is ranked (invite options); use a true app-defined role here.
    expect(findForbiddenRoleAssignment(["TenantAdmin"], ["User"], ["Billing"])).toBeUndefined();
    expect(findForbiddenRoleAssignment(["Admin"], ["User"], ["Billing", "User"])).toBeUndefined();
    // Still cannot assign the unranked role on the write path (fail-closed).
    expect(findForbiddenRoleAssignment(["TenantAdmin"], ["Billing"], ["Billing"])).toBe("Billing");
  });
});
