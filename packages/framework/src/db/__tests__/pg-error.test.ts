import { describe, expect, test } from "bun:test";
import {
  constraintOf,
  extractPgError,
  isTableAlreadyExists,
  isUniqueViolation,
} from "../pg-error.ts";

function serverError(errno: string, constraint?: string): Record<string, unknown> {
  return { code: "ERR_POSTGRES_SERVER_ERROR", errno, constraint };
}

describe("extractPgError", () => {
  test("reads SQLSTATE and constraint from a top-level Bun.SQL server error", () => {
    const info = extractPgError(serverError("23505", "users_email_uq"));
    expect(info).toEqual({ code: "23505", constraint_name: "users_email_uq" });
  });

  test("unwraps a wrapped error's cause", () => {
    const info = extractPgError({ message: "wrapper", cause: serverError("23505", "uq") });
    expect(info).toEqual({ code: "23505", constraint_name: "uq" });
  });

  test("unwraps a PG error nested deeper than one cause layer", () => {
    const info = extractPgError({ cause: { cause: serverError("25006") } });
    expect(info?.code).toBe("25006");
  });

  test("keeps client-side error codes visible", () => {
    const info = extractPgError({ code: "ERR_POSTGRES_CONNECTION_CLOSED" });
    expect(info).toEqual({ code: "ERR_POSTGRES_CONNECTION_CLOSED", constraint_name: undefined });
  });

  test("terminates on a cyclic cause chain", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(extractPgError(cyclic)).toBeNull();
  });

  test("returns null for non-objects", () => {
    expect(extractPgError("nope")).toBeNull();
  });
});

describe("isUniqueViolation", () => {
  test("true for SQLSTATE 23505", () => {
    expect(isUniqueViolation(serverError("23505"))).toBe(true);
  });

  test("false otherwise", () => {
    expect(isUniqueViolation(serverError("23503"))).toBe(false);
  });
});

describe("isTableAlreadyExists", () => {
  test("true for SQLSTATE 42P07", () => {
    expect(isTableAlreadyExists(serverError("42P07"))).toBe(true);
  });
});

describe("constraintOf", () => {
  test("returns the constraint when present", () => {
    expect(constraintOf(serverError("23505", "users_email_uq"))).toBe("users_email_uq");
  });
});
