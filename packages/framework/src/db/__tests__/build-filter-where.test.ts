import { describe, expect, test } from "bun:test";
import { buildFilterWhere } from "../event-store-executor-context";

describe("buildFilterWhere", () => {
  test("eq: returns a direct field-equality WhereObject", () => {
    expect(buildFilterWhere("status", "eq", "active")).toEqual({ status: "active" });
  });

  test("ne: wraps the value in a { ne } clause", () => {
    expect(buildFilterWhere("status", "ne", "active")).toEqual({ status: { ne: "active" } });
  });

  test("lt: wraps the value in a { lt } clause", () => {
    expect(buildFilterWhere("createdAt", "lt", 100)).toEqual({ createdAt: { lt: 100 } });
  });

  test("gt: wraps the value in a { gt } clause", () => {
    expect(buildFilterWhere("createdAt", "gt", 100)).toEqual({ createdAt: { gt: 100 } });
  });

  test("in: non-empty array → direct array WhereObject", () => {
    expect(buildFilterWhere("status", "in", ["active", "pending"])).toEqual({
      status: ["active", "pending"],
    });
  });

  test("in: empty array → null (no-match short-circuit)", () => {
    expect(buildFilterWhere("status", "in", [])).toBeNull();
  });

  test("in: non-array value → null (no-match short-circuit)", () => {
    expect(buildFilterWhere("status", "in", "not-an-array")).toBeNull();
  });
});
