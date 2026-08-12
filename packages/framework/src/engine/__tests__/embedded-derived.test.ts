import { describe, expect, test } from "bun:test";
import { roundDerivedCellValue } from "../embedded-derived";

describe("roundDerivedCellValue — float-noise vs. genuine near-half values", () => {
  test("money: float-multiplication noise just below a half-step still rounds up (deliberate)", () => {
    // 1.005 * 100 === 100.49999999999999 in IEEE754 — this is the case the
    // toPrecision(15) normalisation exists for: it must round to 101 minor
    // units (100.5 → away-from-zero), not 100.
    expect(roundDerivedCellValue(100.49999999999999, { type: "money" })).toBe(101);
  });

  test("money: a value within ~1e-16 of a half-step also snaps up, even though it is not float noise", () => {
    // Pinned trade-off (see the `ponytail:` comment in embedded-derived.ts):
    // toPrecision(15) cannot distinguish "float noise from a real
    // multiplication" from "a value that happens to sit just below .5" —
    // both normalise to the same rounded string and both round up here.
    expect(roundDerivedCellValue(0.49999999999999994, { type: "money" })).toBe(1);
  });

  test("money: a value clearly below the half-step still rounds down", () => {
    expect(roundDerivedCellValue(0.49, { type: "money" })).toBe(0);
  });

  test("decimal: respects the target scale", () => {
    expect(roundDerivedCellValue(1.2345, { type: "decimal", scale: 2 })).toBe(1.23);
  });

  test("non-money/decimal targets pass through unchanged", () => {
    expect(roundDerivedCellValue(1.23456, { type: "number" })).toBe(1.23456);
  });

  test("decimal with no scale: passes the value through unrounded instead of truncating to 0 decimals", () => {
    expect(roundDerivedCellValue(1.2345, { type: "decimal", scale: undefined })).toBe(1.2345);
  });
});
