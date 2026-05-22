import { describe, expect, test } from "vitest";
import { fieldDefinitionAggregateId } from "../aggregate-id";
import { SUPPORTED_FIELD_TYPES } from "../constants";
import { createCustomFieldsFeature } from "../feature";
import { defineFieldPayloadSchema, deleteFieldPayloadSchema } from "../schemas";

// B1 unit-tests: feature-shape, schema-validation, aggregate-id determinism.
// Integration tests (full-stack via setupTestStack) kommen in B2 wenn der
// MSP + Read-Pipeline da ist — die testen ES-Loop end-to-end.

describe("createCustomFieldsFeature shape", () => {
  test("registers field-definition entity + 4 write-handlers + 1 query-handler", () => {
    const feature = createCustomFieldsFeature();

    expect(Object.keys(feature.entities)).toContain("field-definition");

    const writeHandlerNames = Object.keys(feature.writeHandlers);
    expect(writeHandlerNames).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/define-tenant-field/),
        expect.stringMatching(/define-system-field/),
        expect.stringMatching(/delete-tenant-field/),
        expect.stringMatching(/delete-system-field/),
      ]),
    );

    expect(Object.keys(feature.queryHandlers)).toHaveLength(1);
  });
});

describe("defineFieldPayloadSchema", () => {
  test("accepts minimal payload with text field", () => {
    const result = defineFieldPayloadSchema.safeParse({
      entityName: "customer",
      fieldKey: "internalNumber",
      serializedField: { type: "text", required: true, maxLength: 50 },
    });
    expect(result.success).toBe(true);
  });

  test("rejects fieldKey with invalid chars", () => {
    const result = defineFieldPayloadSchema.safeParse({
      entityName: "customer",
      fieldKey: "9starts-with-digit",
      serializedField: { type: "text" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects unknown field-type", () => {
    const result = defineFieldPayloadSchema.safeParse({
      entityName: "customer",
      fieldKey: "weird",
      serializedField: { type: "unknown-type" },
    });
    expect(result.success).toBe(false);
  });

  test("accepts all SUPPORTED_FIELD_TYPES", () => {
    for (const type of SUPPORTED_FIELD_TYPES) {
      const result = defineFieldPayloadSchema.safeParse({
        entityName: "thing",
        fieldKey: "f",
        serializedField: { type },
      });
      expect(result.success).toBe(true);
    }
  });

  test("accepts i18n-label", () => {
    const result = defineFieldPayloadSchema.safeParse({
      entityName: "customer",
      fieldKey: "vipLevel",
      serializedField: { type: "enum", values: ["bronze", "silver", "gold"] },
      label: { de: "VIP-Stufe", en: "VIP Level" },
    });
    expect(result.success).toBe(true);
  });
});

describe("deleteFieldPayloadSchema", () => {
  test("accepts minimal payload", () => {
    const result = deleteFieldPayloadSchema.safeParse({
      entityName: "customer",
      fieldKey: "internalNumber",
    });
    expect(result.success).toBe(true);
  });
});

describe("fieldDefinitionAggregateId determinism", () => {
  test("same inputs produce same uuid", () => {
    const id1 = fieldDefinitionAggregateId("t1", "customer", "internalNumber");
    const id2 = fieldDefinitionAggregateId("t1", "customer", "internalNumber");
    expect(id1).toBe(id2);
  });

  test("different tenants produce different uuids (scope-separation)", () => {
    const idTenant = fieldDefinitionAggregateId("t1", "customer", "internalNumber");
    const idSystem = fieldDefinitionAggregateId(
      "00000000-0000-0000-0000-000000000000",
      "customer",
      "internalNumber",
    );
    expect(idTenant).not.toBe(idSystem);
  });

  test("different fieldKey on same entity produces different uuids", () => {
    const idA = fieldDefinitionAggregateId("t1", "customer", "internalNumber");
    const idB = fieldDefinitionAggregateId("t1", "customer", "vipFlag");
    expect(idA).not.toBe(idB);
  });

  test("aggregate-id format is a valid uuid", () => {
    const id = fieldDefinitionAggregateId("t1", "customer", "internalNumber");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
