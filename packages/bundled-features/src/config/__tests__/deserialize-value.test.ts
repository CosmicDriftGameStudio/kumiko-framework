import { describe, expect, test } from "bun:test";
import { deserializeValue } from "../resolver";

// deserializeValue is the read boundary for every config value: the DB stores
// the JSON-encoded raw string, this turns it back into a typed primitive per the
// key's declared `type`. The coercion has non-obvious paths worth pinning so a
// refactor can't quietly change them: a stored value whose JSON type disagrees
// with the declared type is NOT rejected — it is coerced (number via Number(),
// boolean only via literal true / the string "true", text via String()).

describe("deserializeValue", () => {
  test("null raw short-circuits to undefined before any parse", () => {
    expect(deserializeValue(null, "text")).toBeUndefined();
    expect(deserializeValue(null, "number")).toBeUndefined();
  });

  test("invalid JSON throws (never returns a half-coerced value)", () => {
    expect(() => deserializeValue("{not json", "text")).toThrow();
    expect(() => deserializeValue("", "number")).toThrow();
  });

  describe("number", () => {
    test("a JSON number passes through verbatim", () => {
      expect(deserializeValue("42", "number")).toBe(42);
      expect(deserializeValue("3.14", "number")).toBe(3.14);
      expect(deserializeValue("0", "number")).toBe(0);
      expect(deserializeValue("-5", "number")).toBe(-5);
    });

    test("a stringified number is coerced via Number() — not rejected", () => {
      expect(deserializeValue('"42"', "number")).toBe(42);
      expect(deserializeValue("true", "number")).toBe(1);
    });

    test("an uncoercible value yields NaN rather than throwing", () => {
      expect(deserializeValue('"abc"', "number")).toBeNaN();
    });
  });

  describe("boolean", () => {
    test("a JSON boolean passes through verbatim", () => {
      expect(deserializeValue("true", "boolean")).toBe(true);
      expect(deserializeValue("false", "boolean")).toBe(false);
    });

    test('only the string "true" coerces truthy — every other non-boolean is false', () => {
      expect(deserializeValue('"true"', "boolean")).toBe(true);
      expect(deserializeValue('"false"', "boolean")).toBe(false);
      expect(deserializeValue('"1"', "boolean")).toBe(false);
      expect(deserializeValue("1", "boolean")).toBe(false);
      expect(deserializeValue("0", "boolean")).toBe(false);
    });
  });

  describe("text / select", () => {
    test("a JSON string passes through verbatim", () => {
      expect(deserializeValue('"hello"', "text")).toBe("hello");
      expect(deserializeValue('"hello"', "select")).toBe("hello");
    });

    test("non-string JSON is stringified via String()", () => {
      expect(deserializeValue("42", "text")).toBe("42");
      expect(deserializeValue("true", "select")).toBe("true");
      expect(deserializeValue("null", "text")).toBe("null");
    });
  });
});
