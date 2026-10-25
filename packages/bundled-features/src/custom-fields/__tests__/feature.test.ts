import { describe, expect, test } from "bun:test";
import { fieldDefinitionAggregateId } from "../aggregate-id.ts";
import { createCustomFieldsFeature, resolveFieldDefinitionListRoles } from "../feature.ts";
import { defineFieldPayloadSchema, deleteFieldPayloadSchema } from "../schemas.ts";
import { SUPPORTED_FIELD_TYPES } from "../web/constants.ts";

// Unit tests cover feature shape, schema validation, and aggregate-ID determinism.
// Integration tests (full-stack via setupTestStack) will be added when the
// MSP + read pipeline exists; they test the ES loop end to end.

describe("createCustomFieldsFeature shape", () => {
  test("registers field-definition entity + 6 write-handlers + 1 query-handler", () => {
    const feature = createCustomFieldsFeature();

    expect(Object.keys(feature.entities ?? {})).toContain("field-definition");

    const writeHandlerNames = Object.keys(feature.writeHandlers);
    expect(writeHandlerNames).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/define-tenant-field/),
        expect.stringMatching(/define-system-field/),
        expect.stringMatching(/delete-tenant-field/),
        expect.stringMatching(/delete-system-field/),
        expect.stringMatching(/set-custom-field/),
        expect.stringMatching(/clear-custom-field/),
      ]),
    );

    expect(Object.keys(feature.queryHandlers)).toHaveLength(1);
  });

  test("registers customFields extension-name via extendsRegistrar (B2 wiring opt-in)", () => {
    const feature = createCustomFieldsFeature();
    expect(feature.registrarExtensions["customFields"]).toBeDefined();
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

// The CustomFieldsFormSection dispatches hard-coded bundle QNs, so apps with
// their own role vocabulary (publicstatus: "Admin"/"Editor") must be able to
// override the access roles for value writes and the fieldDefinition list query;
// otherwise every save/load for app users fails with access_denied.
describe("createCustomFieldsFeature access-options", () => {
  function writeAccess(
    feature: ReturnType<typeof createCustomFieldsFeature>,
    nameMatch: string,
  ): readonly string[] {
    const entry = Object.entries(feature.writeHandlers).find(([qn]) => qn.includes(nameMatch));
    if (!entry) throw new Error(`handler ${nameMatch} not registered`);
    const access = entry[1].access;
    if (!access || !("roles" in access)) throw new Error(`handler ${nameMatch} has no roles`);
    return access.roles;
  }

  test("without options: singleton with default roles", () => {
    const feature = createCustomFieldsFeature();
    expect(feature).toBe(createCustomFieldsFeature());
    expect(writeAccess(feature, "set-custom-field")).toEqual(["TenantAdmin", "TenantMember"]);
    expect(writeAccess(feature, "clear-custom-field")).toEqual(["TenantAdmin", "TenantMember"]);
  });

  test("valueWriteRoles overrides set- AND clear-custom-field", () => {
    const feature = createCustomFieldsFeature({ valueWriteRoles: ["Admin", "Editor"] });
    expect(writeAccess(feature, "set-custom-field")).toEqual(["Admin", "Editor"]);
    expect(writeAccess(feature, "clear-custom-field")).toEqual(["Admin", "Editor"]);
    // Definition CRUD remains unchanged because app wrappers handle it.
    expect(writeAccess(feature, "define-tenant-field")).toEqual(["TenantAdmin"]);
  });

  function listAccess(feature: ReturnType<typeof createCustomFieldsFeature>): readonly string[] {
    const entry = Object.entries(feature.queryHandlers).find(([qn]) =>
      qn.includes("field-definition:list"),
    );
    if (!entry) throw new Error("field-definition:list not registered");
    const access = entry[1].access;
    if (!access || !("roles" in access)) throw new Error("list-query has no roles");
    return access.roles;
  }

  test("fieldDefinitionListRoles overrides the List-Query (FormSection loading path)", () => {
    const feature = createCustomFieldsFeature({ fieldDefinitionListRoles: ["Admin", "Editor"] });
    expect(listAccess(feature)).toEqual(["Admin", "Editor"]);
  });

  // valueWriteRoles without fieldDefinitionListRoles broke asymmetrically (save open, list closed) — value roles now inherit into the list default.
  test("valueWriteRoles is inherited as the list default when fieldDefinitionListRoles is missing", () => {
    const feature = createCustomFieldsFeature({ valueWriteRoles: ["Admin", "Editor"] });
    const roles = listAccess(feature);
    // Value writers must also be able to load.
    expect(roles).toContain("Admin");
    expect(roles).toContain("Editor");
    // Admins must retain list access.
    expect(roles).toContain("TenantAdmin");
  });

  test("explicit fieldDefinitionListRoles take precedence over valueWriteRoles inheritance", () => {
    const feature = createCustomFieldsFeature({
      valueWriteRoles: ["Admin", "Editor"],
      fieldDefinitionListRoles: ["Viewer"],
    });
    expect(listAccess(feature)).toEqual(["Viewer"]);
  });

  // define-/update-/delete-tenant-field were hard-wired to
  // ["TenantAdmin"] with no override; fieldDefinitionWriteRoles closes that gap.
  test("fieldDefinitionWriteRoles overrides define-, update-, AND delete-tenant-field", () => {
    const feature = createCustomFieldsFeature({ fieldDefinitionWriteRoles: ["Admin", "Editor"] });
    expect(writeAccess(feature, "define-tenant-field")).toEqual(["Admin", "Editor"]);
    expect(writeAccess(feature, "update-tenant-field")).toEqual(["Admin", "Editor"]);
    expect(writeAccess(feature, "delete-tenant-field")).toEqual(["Admin", "Editor"]);
    // System-scope stays hard-wired — a different trust boundary that must not
    // become reachable through a tenant role vocabulary.
    expect(writeAccess(feature, "define-system-field")).toEqual(["SystemAdmin"]);
    expect(writeAccess(feature, "delete-system-field")).toEqual(["SystemAdmin"]);
  });

  test("fieldDefinitionWriteRoles feeds into list roles and keeps the default TenantAdmin", () => {
    const feature = createCustomFieldsFeature({ fieldDefinitionWriteRoles: ["Admin", "Editor"] });
    const roles = listAccess(feature);
    expect(roles).toEqual(["Admin", "Editor", "TenantAdmin"]);
  });

  test("fieldDefinitionWriteRoles and valueWriteRoles are independent — setting one leaves the other's default", () => {
    const feature = createCustomFieldsFeature({ fieldDefinitionWriteRoles: ["Admin"] });
    expect(writeAccess(feature, "set-custom-field")).toEqual(["TenantAdmin", "TenantMember"]);
    expect(writeAccess(feature, "clear-custom-field")).toEqual(["TenantAdmin", "TenantMember"]);
  });
});

describe("resolveFieldDefinitionListRoles", () => {
  test("nothing set → default only", () => {
    expect(resolveFieldDefinitionListRoles({})).toEqual(["TenantAdmin"]);
  });

  test("valueWriteRoles set, list unset → union with default, deduped", () => {
    expect(resolveFieldDefinitionListRoles({ valueWriteRoles: ["Admin", "Editor"] })).toEqual([
      "Admin",
      "Editor",
      "TenantAdmin",
    ]);
    // TenantAdmin already in valueWriteRoles → no duplicate.
    expect(resolveFieldDefinitionListRoles({ valueWriteRoles: ["TenantAdmin", "Editor"] })).toEqual(
      ["TenantAdmin", "Editor"],
    );
  });

  test("explicit list roles always win (even over valueWriteRoles)", () => {
    expect(
      resolveFieldDefinitionListRoles({
        valueWriteRoles: ["Admin"],
        fieldDefinitionListRoles: ["Viewer"],
      }),
    ).toEqual(["Viewer"]);
  });

  test("fieldDefinitionWriteRoles set, list unset → union with default (TenantAdmin still saves values)", () => {
    expect(
      resolveFieldDefinitionListRoles({ fieldDefinitionWriteRoles: ["Admin", "Editor"] }),
    ).toEqual(["Admin", "Editor", "TenantAdmin"]);
    expect(resolveFieldDefinitionListRoles({ fieldDefinitionWriteRoles: [] })).toEqual([
      "TenantAdmin",
    ]);
  });

  test("valueWriteRoles AND fieldDefinitionWriteRoles → union of both plus default", () => {
    expect(
      resolveFieldDefinitionListRoles({
        valueWriteRoles: ["Member"],
        fieldDefinitionWriteRoles: ["Admin"],
      }),
    ).toEqual(["Member", "Admin", "TenantAdmin"]);
  });
});
