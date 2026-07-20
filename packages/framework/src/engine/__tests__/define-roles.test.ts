import { describe, expect, test } from "bun:test";
import { defineRoles } from "../define-roles";

describe("defineRoles", () => {
  test("maps each role name to itself", () => {
    const roles = defineRoles(["Admin", "SystemAdmin", "Driver"] as const);
    expect(roles.Admin).toBe("Admin");
    expect(roles.SystemAdmin).toBe("SystemAdmin");
    expect(roles.Driver).toBe("Driver");
  });

  test("returns an object with exactly the given keys", () => {
    const roles = defineRoles(["A", "B"] as const);
    expect(Object.keys(roles).sort()).toEqual(["A", "B"]);
  });

  test("an empty role list returns an empty object", () => {
    const roles = defineRoles([] as const);
    expect(roles).toEqual({});
  });
});
