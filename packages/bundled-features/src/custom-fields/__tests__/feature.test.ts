import { describe, expect, test } from "bun:test";
import { fieldDefinitionAggregateId } from "../aggregate-id";
import { SUPPORTED_FIELD_TYPES } from "../constants";
import { createCustomFieldsFeature, resolveFieldDefinitionListRoles } from "../feature";
import { defineFieldPayloadSchema, deleteFieldPayloadSchema } from "../schemas";

// B1 unit-tests: feature-shape, schema-validation, aggregate-id determinism.
// Integration tests (full-stack via setupTestStack) kommen in B2 wenn der
// MSP + Read-Pipeline da ist — die testen ES-Loop end-to-end.

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

// Role-Naming-Drift (Wave J): die CustomFieldsFormSection dispatcht die
// Bundle-QNs hart — Apps mit eigenem Rollen-Vokabular (publicstatus:
// "Admin"/"Editor") müssen die Access-Rollen der Value-Writes + des
// fieldDefinition-List-Queries überschreiben können, sonst ist jeder
// Save/Load für App-User access_denied.
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

  test("ohne Optionen: Singleton mit Default-Rollen", () => {
    const feature = createCustomFieldsFeature();
    expect(feature).toBe(createCustomFieldsFeature());
    expect(writeAccess(feature, "set-custom-field")).toEqual(["TenantAdmin", "TenantMember"]);
    expect(writeAccess(feature, "clear-custom-field")).toEqual(["TenantAdmin", "TenantMember"]);
  });

  test("valueWriteRoles überschreibt set- UND clear-custom-field", () => {
    const feature = createCustomFieldsFeature({ valueWriteRoles: ["Admin", "Editor"] });
    expect(writeAccess(feature, "set-custom-field")).toEqual(["Admin", "Editor"]);
    expect(writeAccess(feature, "clear-custom-field")).toEqual(["Admin", "Editor"]);
    // Definition-CRUD bleibt unberührt — dafür existieren App-Wrapper.
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

  test("fieldDefinitionListRoles überschreibt den List-Query (FormSection-Lade-Pfad)", () => {
    const feature = createCustomFieldsFeature({ fieldDefinitionListRoles: ["Admin", "Editor"] });
    expect(listAccess(feature)).toEqual(["Admin", "Editor"]);
  });

  // #334/2: valueWriteRoles ohne fieldDefinitionListRoles brach asymmetrisch —
  // Save offen für App-Rollen, aber der List-Lade-Pfad blieb ["TenantAdmin"] →
  // App-User bekamen access_denied, die FormSection lud nie. Die Value-Rollen
  // erben jetzt in den List-Default (Union mit dem Default).
  test("valueWriteRoles erbt in den List-Default wenn fieldDefinitionListRoles fehlt", () => {
    const feature = createCustomFieldsFeature({ valueWriteRoles: ["Admin", "Editor"] });
    const roles = listAccess(feature);
    // Value-Writer können laden …
    expect(roles).toContain("Admin");
    expect(roles).toContain("Editor");
    // … und Admins behalten den List-Zugriff.
    expect(roles).toContain("TenantAdmin");
  });

  test("explizite fieldDefinitionListRoles gewinnen über die valueWriteRoles-Vererbung", () => {
    const feature = createCustomFieldsFeature({
      valueWriteRoles: ["Admin", "Editor"],
      fieldDefinitionListRoles: ["Viewer"],
    });
    expect(listAccess(feature)).toEqual(["Viewer"]);
  });
});

describe("resolveFieldDefinitionListRoles", () => {
  test("nichts gesetzt → reiner Default", () => {
    expect(resolveFieldDefinitionListRoles({})).toEqual(["TenantAdmin"]);
  });

  test("valueWriteRoles gesetzt, list ungesetzt → Union mit Default, dedupliziert", () => {
    expect(resolveFieldDefinitionListRoles({ valueWriteRoles: ["Admin", "Editor"] })).toEqual([
      "Admin",
      "Editor",
      "TenantAdmin",
    ]);
    // TenantAdmin schon in valueWriteRoles → keine Dublette.
    expect(resolveFieldDefinitionListRoles({ valueWriteRoles: ["TenantAdmin", "Editor"] })).toEqual(
      ["TenantAdmin", "Editor"],
    );
  });

  test("explizite list-Rollen gewinnen immer (auch über valueWriteRoles)", () => {
    expect(
      resolveFieldDefinitionListRoles({
        valueWriteRoles: ["Admin"],
        fieldDefinitionListRoles: ["Viewer"],
      }),
    ).toEqual(["Viewer"]);
  });
});
