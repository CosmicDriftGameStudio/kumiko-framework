import { describe, expect, test } from "bun:test";
import { sameAnonymizedValue } from "../run-retention-cleanup.ts";

describe("sameAnonymizedValue", () => {
  test("objects with reversed key order are the same value (jsonb reorders keys)", () => {
    expect(sameAnonymizedValue({ b: 1, a: { y: 2, x: 1 } }, { a: { x: 1, y: 2 }, b: 1 })).toBe(
      true,
    );
  });

  test("different content is not the same value, array order matters", () => {
    expect(sameAnonymizedValue({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameAnonymizedValue([1, 2], [2, 1])).toBe(false);
  });

  test("a scalar target compares strictly", () => {
    expect(sameAnonymizedValue("[ANONYMIZED]", "[ANONYMIZED]")).toBe(true);
    expect(sameAnonymizedValue("Alice", "[ANONYMIZED]")).toBe(false);
  });
});
