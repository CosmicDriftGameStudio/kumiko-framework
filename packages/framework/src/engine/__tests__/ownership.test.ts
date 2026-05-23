import { describe, expect, test } from "vitest";
import {
  buildOwnershipClause,
  from,
  matchesRule,
  type OwnershipMap,
  userCanCreateFieldRow,
  userCanReadFieldRow,
  userCanWriteFieldRow,
} from "../ownership";
import type { SessionUser } from "../types";

// Helper — builds SessionUser with optional claims.
function mkUser(
  overrides: Partial<SessionUser> & { claims?: Record<string, unknown> } = {},
): SessionUser {
  return {
    id: overrides.id ?? "11111111-0000-4000-8000-000000000001",
    tenantId: overrides.tenantId ?? "22222222-0000-4000-8000-000000000001",
    roles: overrides.roles ?? ["User"],
    ...(overrides.claims ? { claims: overrides.claims } : {}),
  };
}

// --- from() parser ---

describe("from() — ref parsing", () => {
  test("user:id + explicit column", () => {
    const r = from("user:id", "assigneeId");
    expect(r).toEqual({
      kind: "from",
      refKind: "user",
      refPath: "id",
      column: "assigneeId",
    });
  });

  test("user:tenantId + explicit column", () => {
    const r = from("user:tenantId", "tenantId");
    expect(r.refKind).toBe("user");
    expect(r.refPath).toBe("tenantId");
  });

  test("user-ref without column throws (column required for user-refs)", () => {
    expect(() => from("user:id")).toThrow(/require an explicit column/);
  });

  test("unknown user-ref throws", () => {
    expect(() => from("user:email", "email")).toThrow(/supports only "user:id" or "user:tenantId"/);
  });

  test("claim-ref: default column = claim shortName", () => {
    const r = from("claim:teams:teamId");
    expect(r).toEqual({
      kind: "from",
      refKind: "claim",
      refPath: "teams:teamId",
      column: "teamId", // second segment, auto-derived
    });
  });

  test("claim-ref: explicit column override", () => {
    const r = from("claim:teams:teamId", "teamIdFk");
    expect(r.column).toBe("teamIdFk");
    expect(r.refPath).toBe("teams:teamId"); // full QN still preserved
  });

  test("claim-ref without 2 segments throws", () => {
    expect(() => from("claim:teams")).toThrow(/must be "claim:<featureName>:<shortName>"/);
  });

  test("unknown prefix throws", () => {
    expect(() => from("group:admins")).toThrow(/unsupported ref prefix "group"/);
  });

  test("no colon throws", () => {
    expect(() => from("teamId")).toThrow(/no colon found/);
  });
});

// --- matchesRule() — row-level evaluation ---

describe("matchesRule() — claim scalar", () => {
  test("user claim matches row column → true", () => {
    const rule = from("claim:teams:teamId");
    const user = mkUser({ claims: { "teams:teamId": "eng" } });
    expect(matchesRule(rule, user, { teamId: "eng" })).toBe(true);
  });

  test("user claim mismatches row column → false", () => {
    const rule = from("claim:teams:teamId");
    const user = mkUser({ claims: { "teams:teamId": "eng" } });
    expect(matchesRule(rule, user, { teamId: "ops" })).toBe(false);
  });

  test("user has no claim → false (never match)", () => {
    const rule = from("claim:teams:teamId");
    const user = mkUser({ claims: {} });
    expect(matchesRule(rule, user, { teamId: "eng" })).toBe(false);
  });

  test("row column is null → false (safer default than null-match)", () => {
    const rule = from("claim:teams:teamId");
    const user = mkUser({ claims: { "teams:teamId": "eng" } });
    expect(matchesRule(rule, user, { teamId: null })).toBe(false);
  });
});

describe("matchesRule() — claim array (inArray semantics)", () => {
  test("row value IN user's array → true", () => {
    const rule = from("claim:teams:teamIds", "teamId");
    const user = mkUser({ claims: { "teams:teamIds": ["eng", "ops"] } });
    expect(matchesRule(rule, user, { teamId: "eng" })).toBe(true);
    expect(matchesRule(rule, user, { teamId: "ops" })).toBe(true);
  });

  test("row value NOT in user's array → false", () => {
    const rule = from("claim:teams:teamIds", "teamId");
    const user = mkUser({ claims: { "teams:teamIds": ["eng", "ops"] } });
    expect(matchesRule(rule, user, { teamId: "sales" })).toBe(false);
  });

  test("empty user array → false for any row", () => {
    const rule = from("claim:teams:teamIds", "teamId");
    const user = mkUser({ claims: { "teams:teamIds": [] } });
    expect(matchesRule(rule, user, { teamId: "eng" })).toBe(false);
  });
});

describe("matchesRule() — user:id", () => {
  test("row column equals user.id → true", () => {
    const rule = from("user:id", "assigneeId");
    const user = mkUser({ id: "u-42" });
    expect(matchesRule(rule, user, { assigneeId: "u-42" })).toBe(true);
  });

  test("row column differs from user.id → false", () => {
    const rule = from("user:id", "assigneeId");
    const user = mkUser({ id: "u-42" });
    expect(matchesRule(rule, user, { assigneeId: "u-7" })).toBe(false);
  });
});

describe("matchesRule() — 'all'", () => {
  test("always passes", () => {
    const user = mkUser();
    expect(matchesRule("all", user, { whatever: "anything" })).toBe(true);
    expect(matchesRule("all", user, {})).toBe(true);
  });
});

// --- userCanReadFieldRow() — multi-role, per-role OR ---

describe("userCanReadFieldRow() — multi-role OR", () => {
  const accessMap: OwnershipMap = {
    Admin: "all",
    TeamMember: from("claim:teams:teamId"),
  };

  test("Admin passes regardless of row ('all')", () => {
    const user = mkUser({ roles: ["Admin"] });
    expect(userCanReadFieldRow(user, accessMap, { teamId: "ops" })).toBe(true);
  });

  test("TeamMember passes when claim matches", () => {
    const user = mkUser({ roles: ["TeamMember"], claims: { "teams:teamId": "eng" } });
    expect(userCanReadFieldRow(user, accessMap, { teamId: "eng" })).toBe(true);
  });

  test("TeamMember blocked when claim mismatches", () => {
    const user = mkUser({ roles: ["TeamMember"], claims: { "teams:teamId": "eng" } });
    expect(userCanReadFieldRow(user, accessMap, { teamId: "ops" })).toBe(false);
  });

  test("user with role NOT in map → blocked", () => {
    const user = mkUser({ roles: ["Guest"] });
    expect(userCanReadFieldRow(user, accessMap, { teamId: "eng" })).toBe(false);
  });

  test("undefined access map → public (always read)", () => {
    const user = mkUser({ roles: [] });
    expect(userCanReadFieldRow(user, undefined, { teamId: "eng" })).toBe(true);
  });

  test("empty access map → public (no rules = no restriction)", () => {
    const user = mkUser({ roles: ["Admin"] });
    expect(userCanReadFieldRow(user, {}, { teamId: "eng" })).toBe(true);
  });

  test("multi-role: user has Admin AND TeamMember → Admin wins (short-circuit on 'all')", () => {
    const user = mkUser({
      roles: ["TeamMember", "Admin"],
      claims: { "teams:teamId": "eng" },
    });
    // row with mismatched teamId — TeamMember would fail, Admin passes
    expect(userCanReadFieldRow(user, accessMap, { teamId: "ops" })).toBe(true);
  });
});

// --- userCanWriteFieldRow() — STRADDLE PREVENTION ---

describe("userCanWriteFieldRow() — Straddle-attack prevention", () => {
  // Critical test from the advisor review: a user with two roles,
  // each role's rule matches only ONE of (old, new). An aggregated check
  // (any-role passes old) AND (any-role passes new) would wrongly allow.
  // The correct atomic check requires ONE role whose rule passes BOTH.

  const accessMap: OwnershipMap = {
    Driver: from("user:id", "assigneeId"),
    Manager: from("claim:teams:teamId"),
  };

  test("SECURITY: user with [Driver, Manager], old matches only Driver, new matches only Manager → BLOCKED", () => {
    const user = mkUser({
      id: "me",
      roles: ["Driver", "Manager"],
      claims: { "teams:teamId": "myTeam" },
    });
    const oldRow = { assigneeId: "me", teamId: "otherTeam" }; // Driver ✓, Manager ✗
    const newRow = { assigneeId: "other", teamId: "myTeam" }; // Driver ✗, Manager ✓
    // Per-role atomic: no single role passes both → BLOCKED
    expect(userCanWriteFieldRow(user, accessMap, oldRow, newRow)).toBe(false);
  });

  test("single role passing both old AND new → allowed", () => {
    const user = mkUser({ roles: ["Driver"], id: "me" });
    const oldRow = { assigneeId: "me", teamId: "any" };
    const newRow = { assigneeId: "me", teamId: "any2" }; // still me, just a different team
    expect(userCanWriteFieldRow(user, accessMap, oldRow, newRow)).toBe(true);
  });

  test("role passes old but not new → blocked (attempted row-grab via column change)", () => {
    const user = mkUser({ roles: ["Driver"], id: "me" });
    const oldRow = { assigneeId: "me" };
    const newRow = { assigneeId: "other" }; // tried to reassign to someone else
    expect(userCanWriteFieldRow(user, accessMap, oldRow, newRow)).toBe(false);
  });

  test("role passes new but not old → blocked (attempted grab of foreign row)", () => {
    const user = mkUser({ roles: ["Driver"], id: "me" });
    const oldRow = { assigneeId: "other" }; // this is not my row
    const newRow = { assigneeId: "me" }; // I set it to mine
    expect(userCanWriteFieldRow(user, accessMap, oldRow, newRow)).toBe(false);
  });

  test("'all' rule skips row-check entirely", () => {
    const user = mkUser({ roles: ["Admin"] });
    const map: OwnershipMap = { Admin: "all" };
    expect(userCanWriteFieldRow(user, map, { any: "old" }, { any: "new" })).toBe(true);
  });

  test("user with role NOT in map → blocked", () => {
    const user = mkUser({ roles: ["Guest"] });
    expect(userCanWriteFieldRow(user, accessMap, { assigneeId: "me" }, { assigneeId: "me" })).toBe(
      false,
    );
  });

  test("undefined access map → public (always write)", () => {
    const user = mkUser();
    expect(userCanWriteFieldRow(user, undefined, {}, {})).toBe(true);
  });
});

// --- userCanCreateFieldRow() ---

// --- buildOwnershipClause() — SQL WHERE builder ---

describe("buildOwnershipClause() — SQL WHERE builder", () => {
  // Fake table — buildOwnershipClause checks (table[field] !== undefined)
  // and falls back to snake_case mapping for column names. The fixture
  // shape mirrors drizzle's pgTable for the purposes of the assertions
  // here; we don't assert on the serialized SQL text.
  const fakeTable: Record<string, unknown> = {
    teamId: { name: "team_id" },
    assigneeId: { name: "assignee_id" },
    tenantId: { name: "tenant_id" },
  };

  test("undefined access map → pass (public entity)", () => {
    const user = mkUser();
    expect(buildOwnershipClause(user, undefined, fakeTable).kind).toBe("pass");
  });

  test("empty access map → pass (no rules = no restriction)", () => {
    const user = mkUser();
    expect(buildOwnershipClause(user, {}, fakeTable).kind).toBe("pass");
  });

  test("user role with 'all' → pass (unrestricted, short-circuit)", () => {
    const user = mkUser({ roles: ["Admin"] });
    const map: OwnershipMap = { Admin: "all" };
    expect(buildOwnershipClause(user, map, fakeTable).kind).toBe("pass");
  });

  test("multi-role: any role with 'all' short-circuits to pass", () => {
    const user = mkUser({ roles: ["TeamMember", "Admin"] });
    const map: OwnershipMap = {
      Admin: "all",
      TeamMember: from("claim:teams:teamId"),
    };
    expect(buildOwnershipClause(user, map, fakeTable).kind).toBe("pass");
  });

  test("user has no matching role in map → empty (0 rows returned)", () => {
    const user = mkUser({ roles: ["Guest"] });
    const map: OwnershipMap = { Admin: "all", TeamMember: from("claim:teams:teamId") };
    expect(buildOwnershipClause(user, map, fakeTable).kind).toBe("empty");
  });

  test("claim-rule with matching claim → sql-clause", () => {
    const user = mkUser({
      roles: ["TeamMember"],
      claims: { "teams:teamId": "eng" },
    });
    const map: OwnershipMap = { TeamMember: from("claim:teams:teamId") };
    const clause = buildOwnershipClause(user, map, fakeTable);
    expect(clause.kind).toBe("sql");
  });

  test("array claim with values → sql-clause (inArray)", () => {
    const user = mkUser({
      roles: ["TeamMember"],
      claims: { "teams:teamIds": ["eng", "ops"] },
    });
    const map: OwnershipMap = { TeamMember: from("claim:teams:teamIds", "teamId") };
    expect(buildOwnershipClause(user, map, fakeTable).kind).toBe("sql");
  });

  test("empty array claim → empty (no rows match an empty set)", () => {
    const user = mkUser({
      roles: ["TeamMember"],
      claims: { "teams:teamIds": [] },
    });
    const map: OwnershipMap = { TeamMember: from("claim:teams:teamIds", "teamId") };
    expect(buildOwnershipClause(user, map, fakeTable).kind).toBe("empty");
  });

  test("missing claim → empty (user has role but no claim value)", () => {
    const user = mkUser({ roles: ["TeamMember"], claims: {} });
    const map: OwnershipMap = { TeamMember: from("claim:teams:teamId") };
    expect(buildOwnershipClause(user, map, fakeTable).kind).toBe("empty");
  });

  test("multi-role with mixed claims: one role has claim, other doesn't → sql (OR of passing branches)", () => {
    // Driver-rule always passes against a row where assigneeId exists.
    // Manager-rule collapses to empty (no teamId claim). Result: sql-clause
    // for Driver only, since the Manager branch dropped out.
    const user = mkUser({
      id: "me",
      roles: ["Driver", "Manager"],
      claims: {},
    });
    const map: OwnershipMap = {
      Driver: from("user:id", "assigneeId"),
      Manager: from("claim:teams:teamId"),
    };
    expect(buildOwnershipClause(user, map, fakeTable).kind).toBe("sql");
  });

  test("multi-role all-collapsed-to-empty → empty (every rule dropped)", () => {
    // User has TeamMember + Viewer. Both rules need claims the user doesn't have.
    const user = mkUser({ roles: ["TeamMember", "Viewer"], claims: {} });
    const map: OwnershipMap = {
      TeamMember: from("claim:teams:teamId"),
      Viewer: from("claim:scopes:region"),
    };
    expect(buildOwnershipClause(user, map, fakeTable).kind).toBe("empty");
  });

  test("where-rule escape hatch: caller's SQL passed through", () => {
    const user = mkUser({ roles: ["Auditor"] });
    const map: OwnershipMap = {
      Auditor: { kind: "where", where: () => ({ sqlText: "custom_expr_42 = 1", params: [] }) },
    };
    const clause = buildOwnershipClause(user, map, fakeTable);
    expect(clause.kind).toBe("sql");
  });

  test("unknown column (boot-validator would have caught) → empty fail-closed", () => {
    const user = mkUser({
      roles: ["TeamMember"],
      claims: { "teams:teamId": "eng" },
    });
    const map: OwnershipMap = {
      TeamMember: from("claim:teams:teamId", "nonExistentColumn"),
    };
    // Column not on fakeTable — builder returns empty rather than passing
    // the request through as unrestricted.
    expect(buildOwnershipClause(user, map, fakeTable).kind).toBe("empty");
  });
});

describe("userCanCreateFieldRow() — create case (no old row)", () => {
  const accessMap: OwnershipMap = {
    Admin: "all",
    TeamMember: from("claim:teams:teamId"),
  };

  test("TeamMember creating row with matching teamId → allowed", () => {
    const user = mkUser({
      roles: ["TeamMember"],
      claims: { "teams:teamId": "eng" },
    });
    expect(userCanCreateFieldRow(user, accessMap, { teamId: "eng" })).toBe(true);
  });

  test("TeamMember creating row with foreign teamId → blocked", () => {
    const user = mkUser({
      roles: ["TeamMember"],
      claims: { "teams:teamId": "eng" },
    });
    expect(userCanCreateFieldRow(user, accessMap, { teamId: "ops" })).toBe(false);
  });

  test("Admin 'all' creates anything", () => {
    const user = mkUser({ roles: ["Admin"] });
    expect(userCanCreateFieldRow(user, accessMap, { teamId: "ops" })).toBe(true);
  });
});
