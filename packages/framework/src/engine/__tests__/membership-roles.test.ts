import { describe, expect, test } from "bun:test";
import {
  buildSessionRoles,
  FORBIDDEN_MEMBERSHIP_ROLES,
  findForbiddenMembershipRole,
  isForbiddenMembershipRole,
  stripForbiddenMembershipRoles,
} from "../membership-roles";

describe("forbidden membership roles", () => {
  test("set covers the platform-global/reserved roles", () => {
    expect([...FORBIDDEN_MEMBERSHIP_ROLES].sort()).toEqual(
      ["SystemAdmin", "all", "anonymous", "system"].sort(),
    );
  });

  test("isForbiddenMembershipRole flags reserved, allows tenant roles", () => {
    expect(isForbiddenMembershipRole("SystemAdmin")).toBe(true);
    expect(isForbiddenMembershipRole("system")).toBe(true);
    expect(isForbiddenMembershipRole("all")).toBe(true);
    expect(isForbiddenMembershipRole("anonymous")).toBe(true);
    expect(isForbiddenMembershipRole("Admin")).toBe(false);
    expect(isForbiddenMembershipRole("User")).toBe(false);
  });

  test("findForbiddenMembershipRole returns the first reserved role or undefined", () => {
    expect(findForbiddenMembershipRole(["Admin", "SystemAdmin", "User"])).toBe("SystemAdmin");
    expect(findForbiddenMembershipRole(["Admin", "User"])).toBeUndefined();
  });

  test("strip removes reserved roles, preserves order of the rest", () => {
    expect(stripForbiddenMembershipRoles(["Admin", "SystemAdmin", "User", "all"])).toEqual([
      "Admin",
      "User",
    ]);
    expect(stripForbiddenMembershipRoles(["Editor", "User"])).toEqual(["Editor", "User"]);
    expect(stripForbiddenMembershipRoles(["SystemAdmin"])).toEqual([]);
  });
});

// globalRoles keeps SystemAdmin/system but loses anonymous/all; membershipRoles
// strips all forbidden roles (SystemAdmin, system, anonymous, all).
describe("merge semantics (globalRoles: SystemAdmin/system kept, anonymous/all stripped)", () => {
  test("global SystemAdmin survives (no regression for real admins)", () => {
    expect(buildSessionRoles(["SystemAdmin"], [])).toContain("SystemAdmin");
  });

  test("membership SystemAdmin is stripped (resurrected role neutralised)", () => {
    expect(buildSessionRoles([], ["SystemAdmin"])).not.toContain("SystemAdmin");
  });

  test("global admin + tenant membership keeps both, deduped", () => {
    expect([...buildSessionRoles(["SystemAdmin"], ["Admin", "SystemAdmin"])].sort()).toEqual(
      ["Admin", "SystemAdmin"].sort(),
    );
  });

  test("anonymous/all in globalRoles are stripped, SystemAdmin stays", () => {
    expect([...buildSessionRoles(["anonymous", "all", "SystemAdmin"], [])].sort()).toEqual([
      "SystemAdmin",
    ]);
  });

  test("anonymous/all in membershipRoles are stripped too", () => {
    expect(buildSessionRoles([], ["anonymous", "all", "Admin"])).toEqual(["Admin"]);
  });
});
