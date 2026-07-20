import { describe, expect, test } from "bun:test";
import { parseAuthUserRow } from "../auth-user-row";

describe("parseAuthUserRow", () => {
  test("returns null for null/undefined", () => {
    expect(parseAuthUserRow(null)).toBeNull();
    expect(parseAuthUserRow(undefined)).toBeNull();
  });

  test("returns null for a non-object value", () => {
    expect(parseAuthUserRow("nope")).toBeNull();
    expect(parseAuthUserRow(42)).toBeNull();
  });

  test("returns null when id is missing or not a string", () => {
    expect(parseAuthUserRow({})).toBeNull();
    expect(parseAuthUserRow({ id: 123 })).toBeNull();
  });

  test("returns the row as-is once id is a string", () => {
    const row = {
      id: "u1",
      email: "a@example.com",
      version: 3,
      passwordHash: "hash",
      status: "active",
    };
    expect(parseAuthUserRow(row)).toEqual(row);
  });

  test("passes through a row with only id set — other fields stay undefined", () => {
    const result = parseAuthUserRow({ id: "u2" });
    expect(result?.id).toBe("u2");
    expect(result?.email).toBeUndefined();
  });
});
