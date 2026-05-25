import { describe, expect, test } from "bun:test";
import { constraintOf, extractPgError, isTableAlreadyExists, isUniqueViolation } from "../pg-error";

describe("extractPgError", () => {
  test("reads code from top-level postgres-js error", () => {
    const info = extractPgError({ code: "23505", constraint_name: "users_email_uq" });
    expect(info).toEqual({ code: "23505", constraint_name: "users_email_uq" });
  });

  test("unwraps DrizzleQueryError.cause", () => {
    const info = extractPgError({
      message: "wrapper",
      cause: { code: "23505", constraint_name: "uq" },
    });
    expect(info?.code).toBe("23505");
  });

  test("returns null for non-objects", () => {
    expect(extractPgError("nope")).toBeNull();
  });
});

describe("isUniqueViolation", () => {
  test("true for SQLSTATE 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  test("false otherwise", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
  });
});

describe("isTableAlreadyExists", () => {
  test("true for SQLSTATE 42P07", () => {
    expect(isTableAlreadyExists({ code: "42P07" })).toBe(true);
  });
});

describe("constraintOf", () => {
  test("returns constraint_name when present", () => {
    expect(constraintOf({ constraint_name: "users_email_uq" })).toBe("users_email_uq");
  });
});
