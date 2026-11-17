import { describe, expect, test } from "bun:test";
import { allocateMinorUnits, currencyDecimals, toMajorUnits, toMinorUnits } from "../minor-units.ts";

describe("currency-aware conversion", () => {
  test("toMinorUnits scales by the currency decimals", () => {
    expect(toMinorUnits(12.5, "EUR")).toBe(1250);
    expect(toMinorUnits(1200, "JPY")).toBe(1200);
    expect(toMinorUnits(1.234, "BHD")).toBe(1234);
  });
  test("toMajorUnits scales by the currency decimals", () => {
    expect(toMajorUnits(1250, "EUR")).toBe(12.5);
    expect(toMajorUnits(1200, "JPY")).toBe(1200);
    expect(toMajorUnits(1234, "BHD")).toBe(1.234);
  });
  test("currencyDecimals", () => {
    expect(currencyDecimals("EUR")).toBe(2);
    expect(currencyDecimals("JPY")).toBe(0);
    expect(currencyDecimals("BHD")).toBe(3);
  });
});

describe("allocateMinorUnits", () => {
  test("splits into whole minor units that sum to the total", () => {
    const result = allocateMinorUnits(100, [
      { key: "x", weight: 2 },
      { key: "y", weight: 1 },
    ]);
    expect(Object.fromEntries(result)).toEqual({ x: 67, y: 33 });
  });

  test("breaks ties by key, not by input order", () => {
    const a = { key: "a", weight: 1 };
    const b = { key: "b", weight: 1 };
    const c = { key: "c", weight: 1 };
    expect(Object.fromEntries(allocateMinorUnits(1000, [a, b, c]))).toEqual({
      a: 334,
      b: 333,
      c: 333,
    });
    expect(Object.fromEntries(allocateMinorUnits(1000, [c, b, a]))).toEqual({
      a: 334,
      b: 333,
      c: 333,
    });
  });

  test("negative totals split the same way", () => {
    const result = allocateMinorUnits(-100, [
      { key: "a", weight: 1 },
      { key: "b", weight: 2 },
    ]);
    expect(Object.fromEntries(result)).toEqual({ a: -33, b: -67 });
    expect([...result.values()].reduce((sum, part) => sum + part, 0)).toBe(-100);
  });

  test("a zero weight gets nothing", () => {
    const result = allocateMinorUnits(10, [
      { key: "a", weight: 0 },
      { key: "b", weight: 3 },
    ]);
    expect(Object.fromEntries(result)).toEqual({ a: 0, b: 10 });
  });

  test("a zero total gives every key zero, also with zero weights", () => {
    const result = allocateMinorUnits(0, [
      { key: "a", weight: 0 },
      { key: "b", weight: 0 },
    ]);
    expect(Object.fromEntries(result)).toEqual({ a: 0, b: 0 });
  });

  test("keeps the input order of the keys", () => {
    const result = allocateMinorUnits(5, [
      { key: "z", weight: 1 },
      { key: "a", weight: 1 },
    ]);
    expect([...result.keys()]).toEqual(["z", "a"]);
  });

  test("rejects input that would lose or invent money", () => {
    const one = [{ key: "a", weight: 1 }];
    expect(() => allocateMinorUnits(10.5, one)).toThrow(RangeError);
    expect(() =>
      allocateMinorUnits(10, [
        { key: "a", weight: 1 },
        { key: "a", weight: 1 },
      ]),
    ).toThrow(RangeError);
    expect(() => allocateMinorUnits(10, [{ key: "a", weight: -1 }])).toThrow(RangeError);
    expect(() => allocateMinorUnits(10, [{ key: "a", weight: Number.NaN }])).toThrow(RangeError);
    expect(() =>
      allocateMinorUnits(5, [
        { key: "a", weight: 0 },
        { key: "b", weight: 0 },
      ]),
    ).toThrow(RangeError);
    expect(() => allocateMinorUnits(5, [])).toThrow(RangeError);
  });
});
