import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { createCustomFieldsFeature } from "../feature.ts";
import { buildCustomFieldValueSchema } from "../lib/value-schema.ts";

describe("set-custom-field money contract", () => {
  const moneySchema = buildCustomFieldValueSchema({ type: "money", currency: "EUR" });

  test("accepts an integer minor-unit amount in the definition's currency", () => {
    expect(moneySchema?.safeParse({ amount: 1250, currency: "EUR" }).success).toBe(true);
  });

  test("rejects a major-unit amount, an unsafe integer and a bare number", () => {
    expect(moneySchema?.safeParse({ amount: 12.5, currency: "EUR" }).success).toBe(false);
    expect(moneySchema?.safeParse({ amount: 2 ** 60, currency: "EUR" }).success).toBe(false);
    expect(moneySchema?.safeParse(1250).success).toBe(false);
  });

  test("rejects a currency other than the definition's", () => {
    expect(moneySchema?.safeParse({ amount: 1250, currency: "GBP" }).success).toBe(false);
  });

  test("the agent tool schema of `value` names the minor-unit money shape", () => {
    const setHandler = Object.entries(createCustomFieldsFeature().writeHandlers).find(([qn]) =>
      qn.endsWith("set-custom-field"),
    )?.[1];
    if (!setHandler) throw new Error("set-custom-field not registered");
    const jsonSchema = z.toJSONSchema(setHandler.schema, { io: "input" });
    const valueProperty = jsonSchema.properties?.["value"];
    const description = typeof valueProperty === "object" ? (valueProperty.description ?? "") : "";
    expect(description).toContain("minor units");
    expect(description).toContain("1250");
  });
});

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
