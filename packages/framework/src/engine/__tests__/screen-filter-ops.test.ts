import { describe, expect, test } from "bun:test";
import { createDecimalField, createMoneyField, createNumberField } from "../factories";
import { getAllowedFilterOps, isFieldFilterable } from "../screen-filter-ops";
import type { ScreenFilterOp } from "../types";

const COMPARABLE: ScreenFilterOp[] = ["eq", "ne", "lt", "gt", "in"];

describe("getAllowedFilterOps — decimal is comparable (#343/1)", () => {
  test("decimal yields the full comparable op-set, not the empty default", () => {
    const ops = getAllowedFilterOps(createDecimalField({ precision: 10, scale: 2 }));
    expect([...ops].sort()).toEqual([...COMPARABLE].sort());
    expect(ops.length).toBeGreaterThan(0);
  });

  test("decimal matches number/money — same comparable surface", () => {
    const decimal = getAllowedFilterOps(createDecimalField({ precision: 6, scale: 2 }));
    const number = getAllowedFilterOps(createNumberField({}));
    const money = getAllowedFilterOps(createMoneyField({}));
    expect([...decimal].sort()).toEqual([...number].sort());
    expect([...decimal].sort()).toEqual([...money].sort());
  });

  test("a filterable decimal field is usable: filterable AND non-empty ops", () => {
    const field = createDecimalField({ precision: 8, scale: 2, filterable: true });
    expect(isFieldFilterable(field)).toBe(true);
    // Regression guard: before the fix this returned [] → the boot-validator
    // rejected EVERY filter op on a filterable decimal field ("Allowed ops:
    // (none)"), making the field unusable.
    expect(getAllowedFilterOps(field).length).toBeGreaterThan(0);
  });
});
