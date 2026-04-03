import { describe, test, expect } from "vitest";
import { defineRoles } from "../define-roles";

describe("defineRoles", () => {
  test("returns object with role names as keys and values", () => {
    const roles = defineRoles(["Admin", "SystemAdmin", "Driver"] as const);

    expect(roles.Admin).toBe("Admin");
    expect(roles.SystemAdmin).toBe("SystemAdmin");
    expect(roles.Driver).toBe("Driver");
  });

  test("returned object has exactly the defined roles", () => {
    const roles = defineRoles(["A", "B"] as const);

    expect(Object.keys(roles)).toEqual(["A", "B"]);
    expect(Object.values(roles)).toEqual(["A", "B"]);
  });

  test("works with single role", () => {
    const roles = defineRoles(["OnlyRole"] as const);
    expect(roles.OnlyRole).toBe("OnlyRole");
  });

  test("works with empty array", () => {
    const roles = defineRoles([] as const);
    expect(Object.keys(roles)).toEqual([]);
  });

  test("roles can be used in access rules", () => {
    const roles = defineRoles(["Admin", "User"] as const);
    const access = { roles: [roles.Admin, roles.User] };

    expect(access.roles).toEqual(["Admin", "User"]);
  });
});
