// Regression: deleting a tenant-scoped custom-field definition must only clear
// that tenant's rows — NOT every tenant's row that happens to use the same
// kebab fieldKey.
//
// Bug: the fieldDefinition.deleted MSP-handler stripped the jsonb key from
// every row of the host table (no tenant filter). Two tenants that each define
// their own field with the same key (e.g. "priority") share the jsonb key on
// the host-entity table; one tenant deleting their definition wiped the other
// tenant's values. The fix scopes cleanup by the deleted definition's owning
// tenant (system-scope still cascades to all).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createEntityExecutor,
  createTextField,
  defineEntityListHandler,
  defineFeature,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  testUserId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { z } from "zod";
import { fieldDefinitionEntity } from "../entity";
import { createCustomFieldsFeature } from "../feature";
import { customFieldsField, wireCustomFieldsFor } from "../wire-for-entity";

const propertyEntity = createEntity({
  table: "read_xt_properties",
  fields: {
    name: createTextField({ required: true }),
    customFields: customFieldsField(),
  },
});
const propertyTable = buildEntityTable("property", propertyEntity);

const propertyFeature = defineFeature("property-xt", (r) => {
  r.entity("property", propertyEntity);
  r.requires("custom-fields");
  wireCustomFieldsFor(r, "property", propertyTable);

  const { executor: propertyExecutor } = createEntityExecutor("property", propertyEntity);
  r.writeHandler({
    name: "property:create",
    schema: z.object({ id: z.string(), name: z.string() }),
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) => {
      const payload = event.payload as { id: string; name: string };
      return propertyExecutor.create(
        { id: payload.id, name: payload.name, customFields: {} },
        event.user,
        ctx.db,
      );
    },
  });

  r.queryHandler(
    defineEntityListHandler("property", propertyEntity, { access: { roles: ["TenantAdmin"] } }),
  );
});

const customFieldsFeature = createCustomFieldsFeature();

let stack: TestStack;

const adminA = createTestUser({
  id: testUserId(1),
  tenantId: testTenantId(1),
  roles: ["TenantAdmin"],
});
const adminB = createTestUser({
  id: testUserId(10),
  tenantId: testTenantId(2),
  roles: ["TenantAdmin"],
});

const PROP_A = "aaaaaaaa-aaaa-4000-8000-000000000001";
const PROP_B = "bbbbbbbb-bbbb-4000-8000-000000000002";

beforeAll(async () => {
  stack = await setupTestStack({ features: [customFieldsFeature, propertyFeature] });
  await unsafeCreateEntityTable(stack.db, fieldDefinitionEntity);
  await unsafeCreateEntityTable(stack.db, propertyEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM kumiko_events`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_xt_properties`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_custom_field_definitions`);
});

async function defineField(user: SessionUser, fieldKey: string) {
  return stack.http.writeOk(
    "custom-fields:write:define-tenant-field",
    {
      entityName: "property",
      fieldKey,
      serializedField: { type: "text" },
      required: false,
      searchable: false,
      displayOrder: 0,
    },
    user,
  );
}

async function setCustomField(
  user: SessionUser,
  entityId: string,
  fieldKey: string,
  value: unknown,
) {
  return stack.http.writeOk(
    "custom-fields:write:set-custom-field",
    { entityName: "property", entityId, fieldKey, value },
    user,
  );
}

async function deleteField(user: SessionUser, fieldKey: string) {
  return stack.http.writeOk(
    "custom-fields:write:delete-tenant-field",
    { entityName: "property", fieldKey },
    user,
  );
}

async function createProperty(user: SessionUser, id: string, name: string) {
  return stack.http.writeOk("property-xt:write:property:create", { id, name }, user);
}

async function priorityOf(user: SessionUser, id: string): Promise<unknown> {
  const { rows } = (await stack.http.queryOk("property-xt:query:property:list", {}, user)) as {
    rows: Array<Record<string, unknown>>;
  };
  return rows.find((r) => r["id"] === id)?.["priority"];
}

describe("custom-fields cross-tenant isolation — fieldDefinition delete", () => {
  test("deleting tenant A's field with a shared kebab key must NOT wipe tenant B's values", async () => {
    // Both tenants independently define their own "priority" field on property.
    await defineField(adminA, "priority");
    await defineField(adminB, "priority");

    await createProperty(adminA, PROP_A, "A-Prop");
    await createProperty(adminB, PROP_B, "B-Prop");

    await setCustomField(adminA, PROP_A, "priority", "A-value");
    await setCustomField(adminB, PROP_B, "priority", "B-value");
    await stack.eventDispatcher?.runOnce();

    expect(await priorityOf(adminA, PROP_A)).toBe("A-value");
    expect(await priorityOf(adminB, PROP_B)).toBe("B-value");

    // Tenant A deletes their "priority" field definition.
    await deleteField(adminA, "priority");
    await stack.eventDispatcher?.runOnce();

    // A's value is correctly gone; B's value MUST survive (tenant-scoped cleanup).
    expect(await priorityOf(adminA, PROP_A)).toBeUndefined();
    expect(await priorityOf(adminB, PROP_B)).toBe("B-value");
  });
});
