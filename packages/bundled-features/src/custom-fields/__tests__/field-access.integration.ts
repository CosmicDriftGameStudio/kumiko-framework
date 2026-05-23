// T1.5b — per-field fieldAccess.write enforcement for set/clear handlers.
//
// Verifies that when a fieldDefinition carries
// `serializedField.fieldAccess.write = [<role>, ...]`, the set and clear
// handlers reject calls whose user lacks any of the listed roles — even
// when handler-level RBAC (TenantAdmin/TenantMember) admits them.
//
// Inverse: when fieldAccess.write is absent or empty, the handlers behave
// exactly as in B2 (no extra gate) — the existing roundtrip-test suite
// stays green, and we add an explicit covers-the-no-op-path test here too.

import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createEntityExecutor,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { sql } from "@cosmicdrift/kumiko-framework/db";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { fieldDefinitionEntity } from "../entity";
import { createCustomFieldsFeature } from "../feature";
import { customFieldsField, wireCustomFieldsFor } from "../wire-for-entity";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";

const propertyEntity = createEntity({
  table: "read_t15b_properties",
  fields: {
    name: createTextField({ required: true }),
    customFields: customFieldsField(),
  },
});
const propertyTable = buildDrizzleTable("property", propertyEntity);

const propertyFeature = defineFeature("property-t15b", (r) => {
  r.entity("property", propertyEntity);
  r.requires("custom-fields");
  wireCustomFieldsFor(r, "property", propertyTable);

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

// Two users on the same tenant — both pass handler-level RBAC (which
// accepts both roles), so the only difference that should matter is the
// per-field fieldAccess gate.
const tenantAdmin = createTestUser({ id: 1, roles: ["TenantAdmin"] });
const tenantMember = createTestUser({ id: 2, roles: ["TenantMember"] });

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [customFieldsFeature, propertyFeature],
  });
  await unsafeCreateEntityTable(stack.db, fieldDefinitionEntity);
  await unsafeCreateEntityTable(stack.db, propertyEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_t15b_properties`);
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
    tenantAdmin,
  );
}

describe("T1.5b: per-field fieldAccess.write rejects users without required roles", () => {
  test("set: TenantMember cannot set a field guarded by fieldAccess.write=['TenantAdmin']", async () => {
    const propertyId = "11111111-1111-4000-8000-000000000001";

    await defineField("adminOnly", {
      type: "text",
      fieldAccess: { write: ["TenantAdmin"] },
    });
    await stack.http.writeOk(
      "property-t15b:write:property:create",
      { id: propertyId, name: "BookStore" },
      tenantAdmin,
    );

    const err = await stack.http.writeErr(
      "custom-fields:write:set-custom-field",
      {
        entityName: "property",
        entityId: propertyId,
        fieldKey: "adminOnly",
        value: "X-42",
      },
      tenantMember,
    );

    expect(err.code).toBe("unprocessable");
    expect(err.details).toMatchObject({
      reason: "field_access_denied",
      fieldKey: "adminOnly",
      requiredRoles: ["TenantAdmin"],
    });
  });

  test("set: TenantAdmin passes the same fieldAccess gate", async () => {
    const propertyId = "22222222-2222-4000-8000-000000000002";

    await defineField("adminOnly", {
      type: "text",
      fieldAccess: { write: ["TenantAdmin"] },
    });
    await stack.http.writeOk(
      "property-t15b:write:property:create",
      { id: propertyId, name: "AdminAllowed" },
      tenantAdmin,
    );

    const res = await stack.http.writeOk(
      "custom-fields:write:set-custom-field",
      {
        entityName: "property",
        entityId: propertyId,
        fieldKey: "adminOnly",
        value: "X-42",
      },
      tenantAdmin,
    );

    expect(res).toMatchObject({ entityName: "property", entityId: propertyId });
  });

  test("clear: same gate applies to clear-custom-field", async () => {
    const propertyId = "33333333-3333-4000-8000-000000000003";

    await defineField("adminOnly", {
      type: "boolean",
      fieldAccess: { write: ["TenantAdmin"] },
    });
    await stack.http.writeOk(
      "property-t15b:write:property:create",
      { id: propertyId, name: "ClearGated" },
      tenantAdmin,
    );
    await stack.http.writeOk(
      "custom-fields:write:set-custom-field",
      { entityName: "property", entityId: propertyId, fieldKey: "adminOnly", value: true },
      tenantAdmin,
    );

    const err = await stack.http.writeErr(
      "custom-fields:write:clear-custom-field",
      { entityName: "property", entityId: propertyId, fieldKey: "adminOnly" },
      tenantMember,
    );

    expect(err.details).toMatchObject({
      reason: "field_access_denied",
      fieldKey: "adminOnly",
    });
  });

  test("no-op: fields without fieldAccess.write let TenantMember through (back-compat)", async () => {
    const propertyId = "44444444-4444-4000-8000-000000000004";

    await defineField("openField", { type: "text" });
    await stack.http.writeOk(
      "property-t15b:write:property:create",
      { id: propertyId, name: "OpenAccess" },
      tenantAdmin,
    );

    const res = await stack.http.writeOk(
      "custom-fields:write:set-custom-field",
      {
        entityName: "property",
        entityId: propertyId,
        fieldKey: "openField",
        value: "anyone-can-write-this",
      },
      tenantMember,
    );

    expect(res).toMatchObject({ entityName: "property", entityId: propertyId });
  });

  test("any role in the list grants access — intersection, not subset", async () => {
    const propertyId = "55555555-5555-4000-8000-000000000005";

    await defineField("adminOrMember", {
      type: "text",
      fieldAccess: { write: ["TenantAdmin", "TenantMember"] },
    });
    await stack.http.writeOk(
      "property-t15b:write:property:create",
      { id: propertyId, name: "BothAllowed" },
      tenantAdmin,
    );

    const res = await stack.http.writeOk(
      "custom-fields:write:set-custom-field",
      {
        entityName: "property",
        entityId: propertyId,
        fieldKey: "adminOrMember",
        value: "ok-from-member",
      },
      tenantMember,
    );

    expect(res).toMatchObject({ entityName: "property", entityId: propertyId });
  });

  test("missing fieldDefinition surfaces as not_found (different from access_denied)", async () => {
    const propertyId = "66666666-6666-4000-8000-000000000006";
    await stack.http.writeOk(
      "property-t15b:write:property:create",
      { id: propertyId, name: "NoSuchField" },
      tenantAdmin,
    );

    const err = await stack.http.writeErr(
      "custom-fields:write:set-custom-field",
      {
        entityName: "property",
        entityId: propertyId,
        fieldKey: "neverDefined",
        value: "doesnt-matter",
      },
      tenantAdmin,
    );

    expect(err.code).toBe("not_found");
  });
});
