import { describe, expect, test } from "bun:test";
import { isFieldDefinitionRow, parseSerializedField } from "../lib/parse-serialized-field";

describe("parseSerializedField", () => {
  test("parses a valid JSON string into the typed shape", () => {
    const parsed = parseSerializedField(
      '{"type":"text","retention":{"keepFor":"30d","strategy":"delete"}}',
    );
    expect(parsed).toEqual({ type: "text", retention: { keepFor: "30d", strategy: "delete" } });
  });

  test("throws on a stored definition with the removed `sensitive` key (#972)", () => {
    expect(() => parseSerializedField('{"type":"text","sensitive":true}')).toThrow(
      /custom fields don't support PII/,
    );
  });

  test("accepts an already-parsed object (jsonb-tolerant driver path)", () => {
    const obj = { type: "select", fieldAccess: { write: ["TenantAdmin"] } };
    expect(parseSerializedField(obj)).toBe(obj);
  });

  test("returns null for a corrupt JSON string", () => {
    expect(parseSerializedField("{not json")).toBeNull();
  });

  test("returns null when the shape lacks a string type", () => {
    expect(parseSerializedField('{"fieldAccess":{}}')).toBeNull();
    expect(parseSerializedField({ type: 42 })).toBeNull();
  });

  test("returns null for non-object inputs", () => {
    expect(parseSerializedField(null)).toBeNull();
    expect(parseSerializedField(undefined)).toBeNull();
    expect(parseSerializedField(7)).toBeNull();
  });
});

describe("isFieldDefinitionRow", () => {
  test("true for a row with a string field_key", () => {
    expect(isFieldDefinitionRow({ field_key: "code", serialized_field: "{}" })).toBe(true);
  });

  test("false when field_key is missing or not a string", () => {
    expect(isFieldDefinitionRow({ serialized_field: "{}" })).toBe(false);
    expect(isFieldDefinitionRow({ field_key: 1 })).toBe(false);
  });

  test("false for non-object inputs", () => {
    expect(isFieldDefinitionRow(null)).toBe(false);
    expect(isFieldDefinitionRow("field_key")).toBe(false);
  });
});
