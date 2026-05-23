// T1.5c — user-data-rights wiring for custom-fields.
//
// Verifies the full DSGVO loop for custom-field values on a user-owned
// host entity:
//
//   * Export (Art. 15+20): every row owned by the user contributes its
//     customFields jsonb into the user's export bundle under
//     `<entity>.customFields`.
//
//   * Forget strategy=anonymize (Art. 17 with retention obligation):
//     sensitive customFields keys are stripped from the jsonb; non-
//     sensitive keys stay so co-tenants / co-authors keep useful data.
//
//   * Forget strategy=delete: no-op — the host entity's own user-data-
//     rights hook handles the row delete, jsonb travels with the row.

import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createEntityExecutor,
  createTextField,
  defineFeature,
  EXT_USER_DATA,
  type UserDataDeleteHook,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createDataRetentionFeature } from "../../data-retention";
import { createSessionsFeature } from "../../sessions";
import { createUserFeature, userEntity } from "../../user";
import { createUserDataRightsFeature } from "../../user-data-rights";
import { fieldDefinitionEntity } from "../entity";
import { createCustomFieldsFeature } from "../feature";
import { customFieldsField, wireCustomFieldsFor } from "../wire-for-entity";
import { wireCustomFieldsUserDataRightsFor } from "../wire-user-data-rights";

const propertyEntity = createEntity({
  table: "read_t15c_properties",
  fields: {
    name: createTextField({ required: true }),
    customFields: customFieldsField(),
  },
});
const propertyTable = buildEntityTable("property", propertyEntity);

// Host entity gets its own EXT_USER_DATA-registration too — that's the
// canonical setup (host bundle handles row-anonymize/delete, custom-fields
// adds its strip-sensitive-jsonb layer on top). Both hooks fire in the
// same cleanup-run.
const hostExportHook: UserDataExportHook = async (ctx) => {
  const rows = await asRawClient(ctx.db).unsafe(
    `
    SELECT id, name FROM read_t15c_properties
    WHERE inserted_by_id = $1 AND tenant_id = $2
  `,
    [ctx.userId, ctx.tenantId],
  );
  const list = rows as ReadonlyArray<Record<string, unknown>>;
  if (list.length === 0) return null;
  return {
    entity: "property",
    rows: list.map((r) => ({ id: r["id"] as string, name: r["name"] as string })),
  };
};

const hostDeleteHook: UserDataDeleteHook = async (ctx, strategy) => {
  if (strategy === "delete") {
    await asRawClient(ctx.db).unsafe(
      `
      DELETE FROM read_t15c_properties
      WHERE inserted_by_id = $1 AND tenant_id = $2
    `,
      [ctx.userId, ctx.tenantId],
    );
  } else {
    // anonymize: clear owner, keep row + non-sensitive customFields
    await asRawClient(ctx.db).unsafe(
      `
      UPDATE read_t15c_properties SET inserted_by_id = NULL
      WHERE inserted_by_id = $1 AND tenant_id = $2
    `,
      [ctx.userId, ctx.tenantId],
    );
  }
};

const propertyFeature = defineFeature("property-t15c", (r) => {
  r.entity("property", propertyEntity);
  r.requires("custom-fields");
  wireCustomFieldsFor(r, "property", propertyTable);
  wireCustomFieldsUserDataRightsFor(r, {
    entityName: "property",
    entityTable: propertyTable,
    userIdColumn: "inserted_by_id",
  });
  r.useExtension(EXT_USER_DATA, "property", {
    export: hostExportHook,
    delete: hostDeleteHook,
  });

  const { executor } = createEntityExecutor("property", propertyEntity);
  r.writeHandler({
    name: "property:create",
    schema: z.object({ id: z.string(), name: z.string() }),
    access: { roles: ["TenantAdmin", "TenantMember"] },
    handler: async (event, ctx) =>
      executor.create(
        { id: event.payload.id, name: event.payload.name, customFields: {} },
        event.user,
        ctx.db,
      ),
  });
});

const customFieldsFeature = createCustomFieldsFeature();
const admin = createTestUser({ id: 1, roles: ["TenantAdmin"] });

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createSessionsFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      customFieldsFeature,
      createUserDataRightsFeature(),
      propertyFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, fieldDefinitionEntity);
  await unsafeCreateEntityTable(stack.db, propertyEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_t15c_properties`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_custom_field_definitions`);
});

async function defineField(fieldKey: string, serializedField: Record<string, unknown>) {
  return stack.http.writeOk(
    "custom-fields:write:define-tenant-field",
    {
      entityName: "property",
      fieldKey,
      serializedField,
      required: false,
      searchable: false,
      displayOrder: 0,
    },
    admin,
  );
}

async function createProperty(id: string, name: string) {
  return stack.http.writeOk("property-t15c:write:property:create", { id, name }, admin);
}

async function setField(entityId: string, fieldKey: string, value: unknown) {
  return stack.http.writeOk(
    "custom-fields:write:set-custom-field",
    { entityName: "property", entityId, fieldKey, value },
    admin,
  );
}

async function readRow(id: string): Promise<Record<string, unknown> | undefined> {
  const rows = await asRawClient(stack.db).unsafe(
    `SELECT id, custom_fields FROM read_t15c_properties WHERE id = $1`,
    [id],
  );
  const list = rows as ReadonlyArray<Record<string, unknown>>;
  return list[0];
}

async function callExportHook(userId: string, tenantId: string) {
  const usages = stack.registry.getExtensionUsages(EXT_USER_DATA);
  const customFieldsUsage = usages.find(
    (u) =>
      u.entityName === "property" &&
      (u.options as { export?: unknown })?.export &&
      u.options !== undefined &&
      (u.options as Record<string, unknown>)["export"] !== hostExportHook,
  );
  if (!customFieldsUsage) throw new Error("custom-fields user-data-rights export hook not found");
  const hook = (customFieldsUsage.options as { export: UserDataExportHook }).export;
  return hook({ db: stack.db, tenantId, userId });
}

async function callDeleteHook(userId: string, tenantId: string, strategy: "anonymize" | "delete") {
  const usages = stack.registry.getExtensionUsages(EXT_USER_DATA);
  const customFieldsUsage = usages.find(
    (u) =>
      u.entityName === "property" &&
      (u.options as { delete?: unknown })?.delete &&
      u.options !== undefined &&
      (u.options as Record<string, unknown>)["delete"] !== hostDeleteHook,
  );
  if (!customFieldsUsage) throw new Error("custom-fields user-data-rights delete hook not found");
  const hook = (customFieldsUsage.options as { delete: UserDataDeleteHook }).delete;
  return hook({ db: stack.db, tenantId, userId }, strategy);
}

describe("T1.5c: user-data-rights wiring for custom-fields", () => {
  test("export: customFields jsonb travels into the user's export snippet", async () => {
    const propertyId = "11111111-1111-4000-8000-000000000001";
    await defineField("email", { type: "text", sensitive: true });
    await defineField("vipFlag", { type: "boolean" });
    await createProperty(propertyId, "Hofgarten 12");
    await setField(propertyId, "email", "alice@example.com");
    await setField(propertyId, "vipFlag", true);
    await stack.eventDispatcher?.runOnce();

    const snippet = await callExportHook(String(admin.id), admin.tenantId);
    expect(snippet).not.toBeNull();
    expect(snippet?.entity).toBe("property.customFields");
    expect(snippet?.rows).toHaveLength(1);
    expect(snippet?.rows[0]?.["customFields"]).toMatchObject({
      email: "alice@example.com",
      vipFlag: true,
    });
  });

  test("forget anonymize: sensitive keys stripped, non-sensitive keys kept", async () => {
    const propertyId = "22222222-2222-4000-8000-000000000002";
    await defineField("email", { type: "text", sensitive: true });
    await defineField("vipFlag", { type: "boolean" });
    await createProperty(propertyId, "Anonymize-Me");
    await setField(propertyId, "email", "alice@example.com");
    await setField(propertyId, "vipFlag", true);
    await stack.eventDispatcher?.runOnce();

    await callDeleteHook(String(admin.id), admin.tenantId, "anonymize");

    const row = await readRow(propertyId);
    const customFields = row?.["custom_fields"] as Record<string, unknown> | undefined;
    expect(customFields).toBeDefined();
    expect(customFields).not.toHaveProperty("email");
    expect(customFields).toMatchObject({ vipFlag: true });
  });

  test("forget delete: no-op on customFields (host hook removes the row)", async () => {
    const propertyId = "33333333-3333-4000-8000-000000000003";
    await defineField("email", { type: "text", sensitive: true });
    await createProperty(propertyId, "Delete-Me");
    await setField(propertyId, "email", "alice@example.com");
    await stack.eventDispatcher?.runOnce();

    // call only the custom-fields delete hook (strategy=delete) — verify
    // it doesn't mutate the row (the host hook would handle the actual
    // row delete; we're proving custom-fields stays out of the way).
    await callDeleteHook(String(admin.id), admin.tenantId, "delete");

    const row = await readRow(propertyId);
    const customFields = row?.["custom_fields"] as Record<string, unknown> | undefined;
    expect(customFields).toMatchObject({ email: "alice@example.com" });
  });

  test("export: rows without customFields are not included in the snippet", async () => {
    const propertyId = "44444444-4444-4000-8000-000000000004";
    await createProperty(propertyId, "NoCustomFields");

    const snippet = await callExportHook(String(admin.id), admin.tenantId);
    expect(snippet).toBeNull();
  });

  test("anonymize without sensitive fields defined is a no-op (everything kept)", async () => {
    const propertyId = "55555555-5555-4000-8000-000000000005";
    await defineField("nonSensitive", { type: "text" });
    await createProperty(propertyId, "AllStay");
    await setField(propertyId, "nonSensitive", "still-here");
    await stack.eventDispatcher?.runOnce();

    await callDeleteHook(String(admin.id), admin.tenantId, "anonymize");

    const row = await readRow(propertyId);
    expect((row?.["custom_fields"] as Record<string, unknown>)?.["nonSensitive"]).toBe(
      "still-here",
    );
  });
});
