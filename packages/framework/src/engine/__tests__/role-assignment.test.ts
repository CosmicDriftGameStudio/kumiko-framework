import { describe, expect, test } from "bun:test";
import {
  type AssignableAppRoles,
  type AssignableFromRole,
  assignableAppRolesFromUsages,
  assignableAppRolesOf,
  canActorAssignRole,
  findForbiddenRoleAssignment,
  isAssignableByRole,
  mergeAssignedRoles,
} from "../role-assignment.js";
import type { Registry } from "../types/feature.js";

// Mirror DEFAULT_INVITE_ROLE_OPTIONS — framework must not import bundled-features
// (tsc pulls source into framework's rootDir and fails the package build).
const DEFAULT_INVITE_ROLE_OPTIONS = ["User", "Editor", "Admin", "TenantAdmin"] as const;

describe("role assignment guard", () => {
  test("rejects roles above the actor's highest role", () => {
    expect(findForbiddenRoleAssignment(["Admin"], ["User", "TenantAdmin"], [])).toBe("TenantAdmin");
    expect(findForbiddenRoleAssignment(["TenantAdmin"], ["SystemAdmin"], [])).toBe("SystemAdmin");
  });

  test("allows equal or lower roles, including self-updates", () => {
    expect(findForbiddenRoleAssignment(["Admin"], ["User", "Admin"], [])).toBeUndefined();
    expect(findForbiddenRoleAssignment(["Admin"], ["Editor"], [])).toBeUndefined();
    expect(findForbiddenRoleAssignment(["Editor"], ["User", "Editor"], [])).toBeUndefined();
    expect(findForbiddenRoleAssignment(["TenantAdmin"], ["User", "Admin"], [])).toBeUndefined();
    expect(findForbiddenRoleAssignment(["Admin"], ["Admin"], [])).toBeUndefined();
    expect(findForbiddenRoleAssignment(["SystemAdmin"], ["SystemAdmin"], [])).toBeUndefined();
    expect(findForbiddenRoleAssignment(["system"], ["SystemAdmin"], [])).toBeUndefined();
  });

  test("rejects Editor above User, Admin above Editor", () => {
    expect(findForbiddenRoleAssignment(["User"], ["Editor"], [])).toBe("Editor");
    expect(findForbiddenRoleAssignment(["Editor"], ["Admin"], [])).toBe("Admin");
  });

  test("rejects unknown roles (fail-closed)", () => {
    expect(findForbiddenRoleAssignment(["User"], ["Custom"], [])).toBe("Custom");
    expect(findForbiddenRoleAssignment(["SystemAdmin"], ["Custom"], [])).toBe("Custom");
  });

  test("rejects assignment if actor has no roles or only unknown roles", () => {
    expect(findForbiddenRoleAssignment([], ["User"], [])).toBe("User");
    expect(findForbiddenRoleAssignment(["UnknownRole"], ["User"], [])).toBe("User");
  });

  test("rejects modifying target user with higher existing role", () => {
    expect(findForbiddenRoleAssignment(["Admin"], ["User"], ["SystemAdmin"])).toBe("SystemAdmin");
    expect(findForbiddenRoleAssignment(["TenantAdmin"], ["User"], ["TenantAdmin"])).toBeUndefined();
  });

  test("allows modifying target that currently holds an unranked app role", () => {
    // Editor is ranked (invite options); use a true app-defined role here.
    expect(findForbiddenRoleAssignment(["TenantAdmin"], ["User"], ["Billing"])).toBeUndefined();
    expect(findForbiddenRoleAssignment(["Admin"], ["User"], ["Billing", "User"])).toBeUndefined();
    // Cannot introduce a *new* unranked role (fail-closed).
    expect(findForbiddenRoleAssignment(["TenantAdmin"], ["Billing"], [])).toBe("Billing");
    // Round-trip: strip then re-assign an unranked role the target already had.
    expect(findForbiddenRoleAssignment(["TenantAdmin"], ["Billing"], ["Billing"])).toBeUndefined();
    expect(
      findForbiddenRoleAssignment(["TenantAdmin"], ["User", "Billing"], ["Billing"]),
    ).toBeUndefined();
  });

  test("prototype-polluting role names do not bypass the guard", () => {
    expect(findForbiddenRoleAssignment(["constructor"], ["SystemAdmin"], [])).toBe("SystemAdmin");
    expect(findForbiddenRoleAssignment(["SystemAdmin"], ["toString"], [])).toBe("toString");
  });

  test("empty-string role is forbidden (not truthiness-skipped)", () => {
    expect(findForbiddenRoleAssignment(["Admin"], [""], [])).toBe("");
  });

  test("TenantAdmin can assign every default invite role", () => {
    for (const role of DEFAULT_INVITE_ROLE_OPTIONS) {
      expect(findForbiddenRoleAssignment(["TenantAdmin"], [role], [])).toBeUndefined();
    }
  });
});

function appRoles(entries: [string, AssignableFromRole][]): AssignableAppRoles {
  return new Map(entries);
}

describe("app-declared assignable roles", () => {
  const declared = appRoles([
    ["PropertyManager", "Admin"],
    ["Auditor", "TenantAdmin"],
  ]);

  test("TenantAdmin and Admin grant a role assignable from Admin", () => {
    expect(
      findForbiddenRoleAssignment(["TenantAdmin"], ["PropertyManager"], [], declared),
    ).toBeUndefined();
    expect(
      findForbiddenRoleAssignment(["Admin"], ["PropertyManager"], [], declared),
    ).toBeUndefined();
  });

  test("Admin cannot grant a role assignable from TenantAdmin", () => {
    expect(findForbiddenRoleAssignment(["Admin"], ["Auditor"], [], declared)).toBe("Auditor");
  });

  test("mixed payload still fails on the privileged built-in", () => {
    expect(
      findForbiddenRoleAssignment(["Admin"], ["PropertyManager", "TenantAdmin"], [], declared),
    ).toBe("TenantAdmin");
  });

  test("undeclared roles stay forbidden with a non-empty map", () => {
    expect(findForbiddenRoleAssignment(["TenantAdmin"], ["Unknown"], [], declared)).toBe("Unknown");
  });

  test("an app role does not raise the actor rank", () => {
    const fromSystemAdmin = appRoles([["PropertyManager", "SystemAdmin"]]);
    expect(findForbiddenRoleAssignment(["PropertyManager"], ["User"], [], fromSystemAdmin)).toBe(
      "User",
    );
  });

  test("an app role on the target does not block the actor", () => {
    expect(
      findForbiddenRoleAssignment(["Admin"], ["User"], ["PropertyManager"], declared),
    ).toBeUndefined();
  });

  test("a declaration cannot re-tier a built-in role", () => {
    const sneaky = appRoles([["TenantAdmin", "User"]]);
    expect(findForbiddenRoleAssignment(["Admin"], ["TenantAdmin"], [], sneaky)).toBe("TenantAdmin");
  });

  test("Member ranks with User", () => {
    expect(findForbiddenRoleAssignment(["TenantAdmin"], ["Member"], [])).toBeUndefined();
    expect(findForbiddenRoleAssignment(["Member"], ["User"], [])).toBeUndefined();
  });

  test("prototype keys: declared 'constructor' works, undeclared 'toString' stays forbidden", () => {
    const proto = appRoles([["constructor", "Admin"]]);
    expect(findForbiddenRoleAssignment(["Admin"], ["constructor"], [], proto)).toBeUndefined();
    expect(findForbiddenRoleAssignment(["TenantAdmin"], ["toString"], [], proto)).toBe("toString");
  });

  test("isAssignableByRole compares built-in ranks", () => {
    expect(isAssignableByRole("Admin", "Admin")).toBe(true);
    expect(isAssignableByRole("TenantAdmin", "Admin")).toBe(false);
  });
});

describe("assignableAppRolesFromUsages", () => {
  test("builds a map and defaults assignableFrom to Admin", () => {
    const roles = assignableAppRolesFromUsages([
      { entityName: "PropertyManager" },
      { entityName: "Auditor", options: { assignableFrom: "TenantAdmin" } },
    ]);
    expect(roles.get("PropertyManager")).toBe("Admin");
    expect(roles.get("Auditor")).toBe("TenantAdmin");
  });

  test("same role twice: equal resolved value is fine, conflict throws", () => {
    expect(() =>
      assignableAppRolesFromUsages([
        { entityName: "X" },
        { entityName: "X", options: { assignableFrom: "Admin" } },
      ]),
    ).not.toThrow();
    expect(() =>
      assignableAppRolesFromUsages([
        { entityName: "X", options: { assignableFrom: "Admin" } },
        { entityName: "X", options: { assignableFrom: "TenantAdmin" } },
      ]),
    ).toThrow(/conflicting/);
  });

  test("rejects empty, built-in and reserved role names", () => {
    expect(() => assignableAppRolesFromUsages([{ entityName: "" }])).toThrow(/empty/);
    expect(() => assignableAppRolesFromUsages([{ entityName: "Admin" }])).toThrow(/built-in/);
    for (const platformRole of ["TenantOwner", "DataProtectionOfficer"]) {
      expect(() => assignableAppRolesFromUsages([{ entityName: platformRole }])).toThrow(
        /built-in/,
      );
    }
    for (const reserved of ["system", "SystemAdmin", "all", "anonymous"]) {
      expect(() => assignableAppRolesFromUsages([{ entityName: reserved }])).toThrow();
    }
  });

  test("rejects an invalid assignableFrom", () => {
    for (const bad of ["Root", "__proto__", "system", "", 3]) {
      expect(() =>
        assignableAppRolesFromUsages([{ entityName: "X", options: { assignableFrom: bad } }]),
      ).toThrow(/assignableFrom/);
    }
  });
});

const APP_ROLES = assignableAppRolesFromUsages([
  { entityName: "PropertyManager" },
  { entityName: "Auditor", options: { assignableFrom: "TenantAdmin" } },
]);

describe("canActorAssignRole", () => {
  test("Admin grants ranked and default-declared app roles, not higher or platform roles", () => {
    expect(canActorAssignRole(["Admin"], "Editor", APP_ROLES)).toBe(true);
    expect(canActorAssignRole(["Admin"], "PropertyManager", APP_ROLES)).toBe(true);
    expect(canActorAssignRole(["Admin"], "TenantAdmin", APP_ROLES)).toBe(false);
    expect(canActorAssignRole(["Admin"], "DataProtectionOfficer", APP_ROLES)).toBe(false);
    expect(canActorAssignRole(["Admin"], "Auditor", APP_ROLES)).toBe(false);
    expect(canActorAssignRole(["TenantAdmin"], "Auditor", APP_ROLES)).toBe(true);
  });
});

describe("mergeAssignedRoles", () => {
  test("keeps platform and undeclared roles the actor cannot grant", () => {
    expect(
      mergeAssignedRoles(
        ["Admin"],
        ["Editor"],
        ["Member", "DataProtectionOfficer", "TenantOwner", "Billing"],
        APP_ROLES,
      ),
    ).toEqual(["Editor", "DataProtectionOfficer", "TenantOwner", "Billing"]);
  });

  test("drops grantable roles that are not passed", () => {
    expect(mergeAssignedRoles(["Admin"], ["Admin"], ["Member", "Editor"], APP_ROLES)).toEqual([
      "Admin",
    ]);
  });

  test("does not duplicate a preserved role that is also passed", () => {
    expect(
      mergeAssignedRoles(
        ["TenantAdmin"],
        ["Editor", "DataProtectionOfficer"],
        ["DataProtectionOfficer"],
        APP_ROLES,
      ),
    ).toEqual(["Editor", "DataProtectionOfficer"]);
  });

  test("keeps a higher-tier app role for Admin, drops it for TenantAdmin", () => {
    expect(mergeAssignedRoles(["Admin"], ["Editor"], ["Auditor"], APP_ROLES)).toEqual([
      "Editor",
      "Auditor",
    ]);
    expect(mergeAssignedRoles(["TenantAdmin"], ["Editor"], ["Auditor"], APP_ROLES)).toEqual([
      "Editor",
    ]);
  });
});

describe("assignableAppRolesOf", () => {
  test("builds once per registry object and returns the same map", () => {
    let calls = 0;
    const registry: Pick<Registry, "getExtensionUsages"> = {
      getExtensionUsages: () => {
        calls += 1;
        return [{ entityName: "PropertyManager" }] as never;
      },
    };
    const first = assignableAppRolesOf(registry);
    expect(assignableAppRolesOf(registry)).toBe(first);
    expect(first.get("PropertyManager")).toBe("Admin");
    expect(calls).toBe(1);
  });
});
