import { describe, expect, test } from "bun:test";
import { shallowEqual } from "../equality";

describe("shallowEqual — primitive cases", () => {
  test("Object.is-equal primitives are equal", () => {
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual("a", "a")).toBe(true);
    expect(shallowEqual(true, true)).toBe(true);
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual(undefined, undefined)).toBe(true);
  });

  test("NaN equals NaN (Object.is semantics)", () => {
    expect(shallowEqual(Number.NaN, Number.NaN)).toBe(true);
  });

  test("differing primitives are not equal", () => {
    expect(shallowEqual(1, 2)).toBe(false);
    expect(shallowEqual("a", "b")).toBe(false);
    expect(shallowEqual(0, -0)).toBe(false); // Object.is distinguishes
  });

  test("primitive vs object is not equal", () => {
    expect(shallowEqual(1, { 0: 1 })).toBe(false);
    expect(shallowEqual(null, {})).toBe(false);
    expect(shallowEqual({}, null)).toBe(false);
  });
});

describe("shallowEqual — object cases", () => {
  test("same reference is equal", () => {
    const o = { a: 1 };
    expect(shallowEqual(o, o)).toBe(true);
  });

  test("same keys + same values → equal", () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  test("same keys, different value → not equal", () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
  });

  test("different number of keys → not equal", () => {
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  test("same count, different key names → not equal", () => {
    expect(shallowEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  test("nested object: only top-level refs compared (shallow)", () => {
    const inner = { x: 1 };
    // Same nested ref → equal at top level.
    expect(shallowEqual({ inner }, { inner })).toBe(true);
    // Equivalent but distinct nested ref → NOT equal (shallow doesn't recurse).
    expect(shallowEqual({ inner: { x: 1 } }, { inner: { x: 1 } })).toBe(false);
  });

  test("arrays compared as objects: same length + same values → equal", () => {
    expect(shallowEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(shallowEqual([1, 2, 3], [1, 2, 4])).toBe(false);
    expect(shallowEqual([1, 2], [1, 2, 3])).toBe(false);
  });
});
