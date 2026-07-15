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

// The two cases that discriminate the fix at every JWT mint: the strip wraps
// ONLY the membership portion, never the merged result — so a legitimate
// SystemAdmin in globalRoles survives, a resurrected one in membership does not.
describe("merge semantics (globalRoles never filtered)", () => {
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
});
