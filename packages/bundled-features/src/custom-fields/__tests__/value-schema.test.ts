import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { createCustomFieldsFeature } from "../feature.ts";
import { buildCustomFieldValueSchema } from "../lib/value-schema.ts";
import { defineFieldPayloadSchema, updateFieldPayloadSchema } from "../schemas.ts";

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

describe("embedded sub-types — every allowed sub-type is checked on write", () => {
  const schema = buildCustomFieldValueSchema({
    type: "embedded",
    currency: "EUR",
    schema: {
      fee: { type: "money" },
      tier: { type: "enum", values: ["bronze", "gold"] },
    },
  });

  test("money is an integer amount in minor units", () => {
    expect(schema?.safeParse({ fee: 1250 }).success).toBe(true);
    expect(schema?.safeParse({ fee: 12.5 }).success).toBe(false);
    expect(schema?.safeParse({ fee: 2 ** 60 }).success).toBe(false);
    expect(schema?.safeParse({ fee: { amount: 1250, currency: "EUR" } }).success).toBe(false);
  });

  test("enum takes only its declared values", () => {
    expect(schema?.safeParse({ tier: "gold" }).success).toBe(true);
    expect(schema?.safeParse({ tier: "platinum" }).success).toBe(false);
  });

  test("a key outside the declared sub-fields is refused, in a single row and in a list row", () => {
    expect(schema?.safeParse({ tier: "gold", blob: { nested: "x" } }).success).toBe(false);
    const listSchema = buildCustomFieldValueSchema({
      type: "embedded",
      multiple: true,
      schema: { city: { type: "text" } },
    });
    expect(listSchema?.safeParse([{ city: "Bonn" }]).success).toBe(true);
    expect(listSchema?.safeParse([{ city: "Bonn", blob: [1, 2, 3] }]).success).toBe(false);
  });
});

describe("define payload — an embedded sub-type without a write check is refused", () => {
  function defineWith(serializedField: Record<string, unknown>) {
    return defineFieldPayloadSchema.safeParse({
      entityName: "property",
      fieldKey: "extra",
      serializedField,
    });
  }

  test("accepts every checked sub-type", () => {
    const result = defineWith({
      type: "embedded",
      currency: "EUR",
      schema: {
        city: { type: "text" },
        rooms: { type: "number" },
        rented: { type: "boolean" },
        since: { type: "date" },
        fee: { type: "money" },
        tier: { type: "enum", values: ["bronze", "gold"] },
      },
    });
    expect(result.success).toBe(true);
  });

  test("refuses an unknown sub-type, an enum without values and money without the definition's currency", () => {
    expect(defineWith({ type: "embedded", schema: { blob: { type: "json" } } }).success).toBe(
      false,
    );
    expect(
      defineWith({ type: "embedded", schema: { tier: { type: "enum", values: [] } } }).success,
    ).toBe(false);
    expect(defineWith({ type: "embedded", schema: { fee: { type: "money" } } }).success).toBe(
      false,
    );
  });

  test("refuses an empty sub-field schema, which would check nothing", () => {
    expect(defineWith({ type: "embedded", schema: {} }).success).toBe(false);
  });

  // The update payload may omit type, and a stored definition may hold a sub-type refused
  // today; only update-tenant-field knows both, so the refusal is tested over HTTP there.
  test("the update payload leaves the sub-type check to the handler", () => {
    const result = updateFieldPayloadSchema.safeParse({
      entityName: "property",
      fieldKey: "extra",
      serializedField: { schema: { blob: { type: "json" } } },
    });
    expect(result.success).toBe(true);
  });
});
