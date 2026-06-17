import { describe, expect, test } from "bun:test";
import { createDecimalField, createEntity } from "../factories";
import { buildInsertSchema, isRepresentableAtScale } from "../schema-builder";

describe("isRepresentableAtScale", () => {
  test("accepts a float-artifact value that is in-scale (0.1 + 0.2 @ scale 2)", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // sanity: the artifact is real
    expect(isRepresentableAtScale(0.1 + 0.2, 2)).toBe(true);
  });

  test("accepts exact in-scale values", () => {
    expect(isRepresentableAtScale(12.34, 2)).toBe(true);
    expect(isRepresentableAtScale(0, 2)).toBe(true);
    expect(isRepresentableAtScale(-99.99, 2)).toBe(true);
    expect(isRepresentableAtScale(1000, 0)).toBe(true);
  });

  test("rejects a genuinely over-scale value", () => {
    expect(isRepresentableAtScale(0.305, 2)).toBe(false);
    expect(isRepresentableAtScale(1.5, 0)).toBe(false);
    expect(isRepresentableAtScale(0.001, 2)).toBe(false);
  });
});

describe("decimal field write-schema scale enforcement", () => {
  const schema = buildInsertSchema(
    createEntity({
      table: "Test",
      fields: { amount: createDecimalField({ precision: 6, scale: 2, required: true }) },
    }),
  );

  test("a computed-but-in-scale value is accepted (no false reject from float drift)", () => {
    const parsed = schema.parse({ amount: 0.1 + 0.2 });
    expect((parsed as { amount: number }).amount).toBeCloseTo(0.3, 10);
  });

  test("an over-scale value is still rejected", () => {
    expect(() => schema.parse({ amount: 0.305 })).toThrow();
  });
});

describe("createDecimalField precision/scale validation", () => {
  test("accepts a valid numeric(p,s)", () => {
    expect(() => createDecimalField({ precision: 10, scale: 2 })).not.toThrow();
    expect(() => createDecimalField({ precision: 1, scale: 0 })).not.toThrow();
    expect(() => createDecimalField({ precision: 5, scale: 5 })).not.toThrow();
  });

  test("rejects scale > precision (Postgres-invalid numeric(2,4))", () => {
    expect(() => createDecimalField({ precision: 2, scale: 4 })).toThrow(/scale ≤ precision/);
  });

  test("rejects non-integer or out-of-range precision/scale", () => {
    expect(() => createDecimalField({ precision: 2.5, scale: 1 })).toThrow();
    expect(() => createDecimalField({ precision: 0, scale: 0 })).toThrow();
    expect(() => createDecimalField({ precision: 4, scale: -1 })).toThrow();
  });
});
