import { describe, expect, test } from "bun:test";
import { compareByCodepoint } from "../compare";

describe("compareByCodepoint", () => {
  test("returns -1 / 1 / 0 for less / greater / equal", () => {
    expect(compareByCodepoint("a", "b")).toBe(-1);
    expect(compareByCodepoint("b", "a")).toBe(1);
    expect(compareByCodepoint("x", "x")).toBe(0);
  });

  test("orders by UTF-16 code unit — uppercase sorts before lowercase", () => {
    // 'Z' (90) < 'a' (97): the opposite of many locale collations, which is
    // the whole point (#330 — stable across macOS dev box and Linux CI).
    expect(compareByCodepoint("Z", "a")).toBe(-1);
  });

  test("is a usable Array.sort comparator yielding codepoint order", () => {
    expect(["b", "A", "a", "B"].sort(compareByCodepoint)).toEqual(["A", "B", "a", "b"]);
  });
});
