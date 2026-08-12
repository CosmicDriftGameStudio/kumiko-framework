import { describe, expect, test } from "bun:test";
import { roundDerivedCellValue } from "../embedded-derived";

describe("roundDerivedCellValue", () => {
  test("money: rounds to an integer (minor units)", () => {
    expect(roundDerivedCellValue(100.6, { type: "money" })).toBe(101);
  });

  test("decimal: rounds to the declared scale", () => {
    expect(roundDerivedCellValue(1.005, { type: "decimal", scale: 2 })).toBe(1.01);
  });

  test("decimal with no scale: passes the value through unrounded instead of truncating to 0 decimals", () => {
    expect(roundDerivedCellValue(1.2345, { type: "decimal", scale: undefined })).toBe(1.2345);
  });

  test("every other target type passes through unchanged", () => {
    expect(roundDerivedCellValue(1.2345, { type: "text" })).toBe(1.2345);
  });
});
