// Regression: a custom-field set/clear must only touch the calling tenant's own
// row. aggregateId is a globally-unique row UUID, so without a tenant_id filter
// on the projection UPDATE, tenant A could overwrite or clear tenant B's
// customFields just by passing B's known row UUID as entityId. The set/clear
// projection writes now scope to the event's own tenant (same guard the
// fieldDefinition-delete path already uses).

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
  table: "read_xt_set_properties",
  fields: {
    name: createTextField({ required: true }),
    customFields: customFieldsField(),
  },
});
const propertyTable = buildEntityTable("property", propertyEntity);

const propertyFeature = defineFeature("property-xt-set", (r) => {
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

async function setField(user: SessionUser, entityId: string, fieldKey: string, value: unknown) {
  return stack.http.writeOk(
    "custom-fields:write:set-custom-field",
    { entityName: "property", entityId, fieldKey, value },
    user,
  );
}

async function clearField(user: SessionUser, entityId: string, fieldKey: string) {
  return stack.http.writeOk(
    "custom-fields:write:clear-custom-field",
    { entityName: "property", entityId, fieldKey },
    user,
  );
}

async function createProperty(user: SessionUser, id: string, name: string) {
  return stack.http.writeOk("property-xt-set:write:property:create", { id, name }, user);
}

async function priorityOf(user: SessionUser, id: string): Promise<unknown> {
  const { rows } = (await stack.http.queryOk("property-xt-set:query:property:list", {}, user)) as {
    rows: Array<Record<string, unknown>>;
  };
  return rows.find((r) => r["id"] === id)?.["priority"];
}

describe("custom-fields cross-tenant isolation — set/clear write", () => {
  beforeEach(async () => {
    await asRawClient(stack.db).unsafe(`DELETE FROM kumiko_events`);
    await asRawClient(stack.db).unsafe(`DELETE FROM read_xt_set_properties`);
    await asRawClient(stack.db).unsafe(`DELETE FROM read_custom_field_definitions`);

    // Both tenants independently define their own "priority" field and own a row.
    await defineField(adminA, "priority");
    await defineField(adminB, "priority");
    await createProperty(adminA, PROP_A, "A-Prop");
    await createProperty(adminB, PROP_B, "B-Prop");
    await setField(adminA, PROP_A, "priority", "A-value");
    await setField(adminB, PROP_B, "priority", "B-value");
    await stack.eventDispatcher?.runOnce();
    expect(await priorityOf(adminB, PROP_B)).toBe("B-value");
  });

  test("tenant A cannot overwrite tenant B's row via a known entityId (set)", async () => {
    // The set-handler runs as A (its own field-definition + RBAC pass) and emits
    // on A's stream; the projection's tenant filter must keep it off B's row.
    await setField(adminA, PROP_B, "priority", "HACKED");
    await stack.eventDispatcher?.runOnce();

    expect(await priorityOf(adminB, PROP_B)).toBe("B-value");
  });

  test("tenant A cannot clear tenant B's row via a known entityId (clear)", async () => {
    await clearField(adminA, PROP_B, "priority");
    await stack.eventDispatcher?.runOnce();

    expect(await priorityOf(adminB, PROP_B)).toBe("B-value");
  });

  test("a tenant's own set still applies (filter does not block the legitimate path)", async () => {
    await setField(adminA, PROP_A, "priority", "A-updated");
    await stack.eventDispatcher?.runOnce();

    expect(await priorityOf(adminA, PROP_A)).toBe("A-updated");
    expect(await priorityOf(adminB, PROP_B)).toBe("B-value");
  });
});
