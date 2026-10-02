import { describe, expect, test } from "bun:test";
import { assertQualifiedWhereFragment, tableColumnSqlNames } from "../where-rule-lint.js";

const COLUMNS = new Set(["entity_id", "team_id", "owner_id"]);

describe("assertQualifiedWhereFragment — passes (not a tautology)", () => {
  test.each([
    ["literal true", "1=1"],
    ["unqualified column, no subquery", "owner_id = $1"],
    ["unknown identifier compared to a literal", "custom_expr_42 = 1"],
    [
      "correctly qualified subquery",
      "EXISTS (SELECT 1 FROM teams t WHERE t.entity_id = read_notes.entity_id AND t.team_id = $1)",
    ],
    [
      "unqualified outer column next to a correctly qualified subquery",
      "owner_id = $1 OR EXISTS (SELECT 1 FROM shares s WHERE s.entity_id = read_x.entity_id)",
    ],
    [
      "unqualified outer column before a subquery, both sides of the paren block",
      "entity_id = $1 AND (EXISTS (SELECT 1 FROM shares s WHERE s.user_id = $2) OR team_id = $3)",
    ],
    [
      "column name only inside a string literal",
      "EXISTS (SELECT 1 FROM teams t WHERE t.label = 'entity_id')",
    ],
    [
      "column name only inside a line comment",
      "EXISTS (SELECT 1 FROM teams t WHERE t.x = $1) -- entity_id",
    ],
  ])("%s", (_label, sqlText) => {
    expect(() => assertQualifiedWhereFragment(sqlText, COLUMNS, "scope")).not.toThrow();
  });
});

describe("assertQualifiedWhereFragment — throws (fail-closed)", () => {
  test("unqualified column shadowed inside a subquery (the real bug)", () => {
    expect(() =>
      assertQualifiedWhereFragment(
        "EXISTS (SELECT 1 FROM teams t WHERE t.entity_id = entity_id AND t.team_id = $1)",
        COLUMNS,
        "scope",
      ),
    ).toThrow(/unqualified/i);
  });

  test("double-quoted unqualified column inside a subquery", () => {
    expect(() =>
      assertQualifiedWhereFragment(
        'EXISTS (SELECT 1 FROM teams t WHERE t.entity_id = "entity_id")',
        COLUMNS,
        "scope",
      ),
    ).toThrow(/unqualified/i);
  });

  test("unqualified column inside the subquery still throws when an outer one is also bare", () => {
    expect(() =>
      assertQualifiedWhereFragment(
        "owner_id = $1 OR EXISTS (SELECT 1 FROM t WHERE t.x = owner_id)",
        COLUMNS,
        "scope",
      ),
    ).toThrow(/column "owner_id" unqualified/);
  });

  test("bare self-comparison", () => {
    expect(() => assertQualifiedWhereFragment("team_id = team_id", COLUMNS, "scope")).toThrow(
      /tautology/i,
    );
  });

  test("qualified self-comparison", () => {
    expect(() =>
      assertQualifiedWhereFragment("t.entity_id = t.entity_id", COLUMNS, "scope"),
    ).toThrow(/tautology/i);
  });

  test("$N placeholders never count as identifiers", () => {
    // Regression guard: if the identifier regex ever matched "$1", this
    // would misfire as a self-comparison between two placeholders.
    expect(() => assertQualifiedWhereFragment("$1 = $1", COLUMNS, "scope")).not.toThrow();
  });
});

describe("tableColumnSqlNames", () => {
  test("plain-object table maps field keys to snake_case SQL names", () => {
    const names = tableColumnSqlNames({ teamId: { name: "team_id" } });
    expect(names.has("team_id")).toBe(true);
  });

  test("non-object table yields an empty set", () => {
    expect(tableColumnSqlNames(null).size).toBe(0);
    expect(tableColumnSqlNames(undefined).size).toBe(0);
    expect(tableColumnSqlNames("not a table").size).toBe(0);
  });
});
