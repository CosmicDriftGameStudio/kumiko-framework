import { describe, expect, test } from "bun:test";
import { buildFieldDefinitionColumns } from "../lib/field-definition-row";
import { defineFieldPayloadSchema } from "../schemas";

function parse(input: unknown) {
  const result = defineFieldPayloadSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`payload invalid: ${result.error.message}`);
  }
  return result.data;
}

describe("buildFieldDefinitionColumns — denormalized columns derive from serializedField", () => {
  test("serializedField.required wins when present (no top-level required)", () => {
    const payload = parse({
      entityName: "customer",
      fieldKey: "internalNumber",
      serializedField: { type: "text", required: true, maxLength: 50 },
    });
    const row = buildFieldDefinitionColumns(payload);
    expect(row.required).toBe(true);
    expect(JSON.parse(row.serializedField).required).toBe(true);
  });

  test("top-level value is used when serializedField omits the key", () => {
    const payload = parse({
      entityName: "customer",
      fieldKey: "vipFlag",
      serializedField: { type: "boolean" },
      required: true,
      searchable: true,
      displayOrder: 3,
    });
    const row = buildFieldDefinitionColumns(payload);
    expect(row.required).toBe(true);
    expect(row.searchable).toBe(true);
    expect(row.displayOrder).toBe(3);
  });

  test("serializedField wins over a conflicting top-level value", () => {
    const payload = parse({
      entityName: "customer",
      fieldKey: "code",
      serializedField: { type: "text", required: false },
      required: true,
    });
    const row = buildFieldDefinitionColumns(payload);
    expect(row.required).toBe(false);
  });

  test("defaults to false/0 when neither source sets the key", () => {
    const payload = parse({
      entityName: "customer",
      fieldKey: "note",
      serializedField: { type: "text" },
    });
    const row = buildFieldDefinitionColumns(payload);
    expect(row.required).toBe(false);
    expect(row.searchable).toBe(false);
    expect(row.displayOrder).toBe(0);
  });
});
