// createNumberField({ unit }) passthrough — pins that NumberFieldDef.unit
// survives the factory's Partial<Omit<...>> spread, static string and
// sibling-field-reference form alike.

import { describe, expect, test } from "bun:test";
import { createNumberField } from "../factories";

describe("createNumberField — unit passthrough", () => {
  test("static unit string is preserved", () => {
    const f = createNumberField({ unit: "km" });
    expect(f.unit).toBe("km");
  });

  test("sibling-field unit reference is preserved", () => {
    const f = createNumberField({ unit: { field: "mileageUnit" } });
    expect(f.unit).toEqual({ field: "mileageUnit" });
  });

  test("omitted unit stays undefined", () => {
    const f = createNumberField();
    expect(f.unit).toBeUndefined();
  });
});
