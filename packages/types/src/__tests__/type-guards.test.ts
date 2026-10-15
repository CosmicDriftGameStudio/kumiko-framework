import { describe, expect, test } from "bun:test";
import { errorCodeOf, isOneOf, isPlainObject } from "../type-guards.js";

describe("isPlainObject", () => {
  test("accepts plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  test("rejects null, arrays, and primitives", () => {
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject("x")).toBe(false);
    expect(isPlainObject(42)).toBe(false);
  });
});

describe("isOneOf", () => {
  const verbs = ["create", "update"] as const;

  test("matches members and narrows the type", () => {
    const candidate: unknown = "update";
    if (isOneOf(verbs, candidate)) {
      const narrowed: "create" | "update" = candidate;
      expect(narrowed).toBe("update");
    } else {
      throw new Error("expected membership");
    }
  });

  test("rejects non-members and other types", () => {
    expect(isOneOf(verbs, "delete")).toBe(false);
    expect(isOneOf(verbs, 1)).toBe(false);
    expect(isOneOf(verbs, undefined)).toBe(false);
  });

  test("uses strict equality, not string coercion", () => {
    expect(isOneOf([1, 2] as const, "1")).toBe(false);
    expect(isOneOf([1, 2] as const, 1)).toBe(true);
  });
});

describe("errorCodeOf", () => {
  test("reads a string code from Error subclasses and plain objects", () => {
    expect(errorCodeOf(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe("ENOENT");
    expect(errorCodeOf({ code: "23505" })).toBe("23505");
  });

  test("returns undefined for missing or non-string codes and non-objects", () => {
    expect(errorCodeOf(new Error("x"))).toBeUndefined();
    expect(errorCodeOf({ code: 42 })).toBeUndefined();
    expect(errorCodeOf(null)).toBeUndefined();
    expect(errorCodeOf("ENOENT")).toBeUndefined();
  });
});
