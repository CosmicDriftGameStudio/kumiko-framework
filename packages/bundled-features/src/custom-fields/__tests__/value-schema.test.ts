import { describe, expect, test } from "bun:test";
import { buildCustomFieldValueSchema } from "../lib/value-schema";

describe("buildCustomFieldValueSchema — type-shape only", () => {
  test("strips top-level constraint keys (required/maxLength/format)", () => {
    const schema = buildCustomFieldValueSchema({
      type: "text",
      required: true,
      maxLength: 5,
      format: "email",
    });
    expect(schema).not.toBeNull();
    expect(schema?.safeParse("").success).toBe(true);
    expect(schema?.safeParse("not-an-email-and-way-too-long").success).toBe(true);
    expect(schema?.safeParse(42).success).toBe(false);
  });

  test("embedded validates sub-field TYPE only — sub-field `required` is stripped", () => {
    const schema = buildCustomFieldValueSchema({
      type: "embedded",
      schema: { city: { type: "text", required: true } },
    });
    expect(schema).not.toBeNull();
    // type-valid objects pass, regardless of the sub-field `required` flag
    expect(schema?.safeParse({ city: "Bonn" }).success).toBe(true);
    expect(schema?.safeParse({}).success).toBe(true);
    expect(schema?.safeParse({ city: "" }).success).toBe(true);
    // type-mismatches still rejected: non-object, and wrong sub-field type
    expect(schema?.safeParse("not-an-object").success).toBe(false);
    expect(schema?.safeParse({ city: 123 }).success).toBe(false);
  });

  test("embedded strip applies to non-text sub-types too (number)", () => {
    const schema = buildCustomFieldValueSchema({
      type: "embedded",
      schema: { age: { type: "number", required: true } },
    });
    expect(schema).not.toBeNull();
    expect(schema?.safeParse({ age: 7 }).success).toBe(true);
    // required stripped → missing key passes (pre-fix the non-optional number
    // sub-field rejected it)
    expect(schema?.safeParse({}).success).toBe(true);
    // type-mismatch still rejected
    expect(schema?.safeParse({ age: "not-a-number" }).success).toBe(false);
  });

  test("embedded with an unsupported sub-type → null (skip validation)", () => {
    const schema = buildCustomFieldValueSchema({
      type: "embedded",
      schema: { blob: { type: "json" } },
    });
    expect(schema).toBeNull();
  });
});
