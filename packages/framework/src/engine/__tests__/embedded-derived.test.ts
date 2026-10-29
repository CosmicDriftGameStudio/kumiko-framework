import { describe, expect, test } from "bun:test";
import type { EmbeddedDerivedCellDef } from "@cosmicdrift/kumiko-types/fields";
import { roundDerivedCellValue, withDerivedCells } from "../embedded-derived.ts";

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

describe("withDerivedCells — inRange", () => {
  const derived: Record<string, EmbeddedDerivedCellDef> = {
    result: { op: "inRange", from: ["measured", "min", "max"], inside: "ok", outside: "not_ok" },
  };
  const targets = { result: { type: "select" as const } };
  const run = (row: Record<string, unknown>) => withDerivedCells(row, derived, targets);

  test("inside and outside the bounds", () => {
    expect(run({ measured: 190, min: 180, max: 200 })).toMatchObject({ result: "ok" });
    expect(run({ measured: 210, min: 180, max: 200 })).toMatchObject({ result: "not_ok" });
    expect(run({ measured: 170, min: 180, max: 200 })).toMatchObject({ result: "not_ok" });
  });

  test("bounds are inclusive", () => {
    expect(run({ measured: 180, min: 180, max: 200 })).toMatchObject({ result: "ok" });
    expect(run({ measured: 200, min: 180, max: 200 })).toMatchObject({ result: "ok" });
  });

  test("a missing bound leaves that side open", () => {
    expect(run({ measured: 5, max: 10 })).toMatchObject({ result: "ok" });
    expect(run({ measured: 50, max: 10 })).toMatchObject({ result: "not_ok" });
    expect(run({ measured: 50, min: 10 })).toMatchObject({ result: "ok" });
    expect(run({ measured: 5, min: 10 })).toMatchObject({ result: "not_ok" });
  });

  test("missing value or both bounds missing clears the cell", () => {
    expect(run({ min: 1, max: 2, result: "ok" })).not.toHaveProperty("result");
    expect(run({ measured: 5, result: "ok" })).not.toHaveProperty("result");
  });
});

describe("withDerivedCells — when", () => {
  const derived: Record<string, EmbeddedDerivedCellDef> = {
    total: { op: "multiply", from: ["qty", "price"], when: { field: "kind", eq: "calc" } },
  };
  const targets = { total: { type: "number" as const } };

  test("when false keeps the manual value", () => {
    const row = { kind: "manual", qty: 2, price: 3, total: 99 };
    expect(withDerivedCells(row, derived, targets)).toEqual(row);
  });

  test("when true overwrites a client-sent value", () => {
    expect(
      withDerivedCells({ kind: "calc", qty: 2, price: 3, total: 99 }, derived, targets),
    ).toEqual({
      kind: "calc",
      qty: 2,
      price: 3,
      total: 6,
    });
  });
});
