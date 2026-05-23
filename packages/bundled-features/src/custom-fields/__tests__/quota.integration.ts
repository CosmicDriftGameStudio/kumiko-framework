// T1.5e — per-tenant fieldDefinition quota.
//
// `createCustomFieldsFeature({ fieldDefinitionLimitPerTenant: N })`
// installs a quota-aware `define-tenant-field` handler. The handler
// rejects with `unprocessable` + reason `cap_exceeded` when the
// tenant already has >= N definitions.

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
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { fieldDefinitionEntity } from "../entity";
import { createCustomFieldsFeature } from "../feature";
import { customFieldsField, wireCustomFieldsFor } from "../wire-for-entity";

const propertyEntity = createEntity({
  table: "read_t15e_properties",
  fields: {
    name: createTextField({ required: true }),
    customFields: customFieldsField(),
  },
});
const propertyTable = buildDrizzleTable("property", propertyEntity);

const propertyFeature = defineFeature("property-t15e", (r) => {
  r.entity("property", propertyEntity);
  r.requires("custom-fields");
  wireCustomFieldsFor(r, "property", propertyTable);

  const { executor } = createEntityExecutor("property", propertyEntity);
  r.writeHandler({
    name: "property:create",
    schema: z.object({ id: z.string(), name: z.string() }),
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) =>
      executor.create(
        { id: event.payload.id, name: event.payload.name, customFields: {} },
        event.user,
        ctx.db,
      ),
  });
});

const QUOTA = 3;
const customFieldsFeature = createCustomFieldsFeature({ fieldDefinitionLimitPerTenant: QUOTA });
const admin = createTestUser({ id: 1, roles: ["TenantAdmin"] });

let stack: TestStack;

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
  await resetEventStore(stack);
  await stack.db.execute(sql`DELETE FROM read_t15e_properties`);
  await stack.db.execute(sql`DELETE FROM read_custom_field_definitions`);
});

async function defineField(fieldKey: string) {
  return stack.http.write(
    "custom-fields:write:define-tenant-field",
    {
      entityName: "property",
      fieldKey,
      serializedField: { type: "text" },
      required: false,
      searchable: false,
      displayOrder: 0,
    },
    admin,
  );
}

describe("T1.5e: per-tenant fieldDefinition quota", () => {
  test(`tenant can define up to ${QUOTA} fields, then the next one is rejected`, async () => {
    for (let i = 1; i <= QUOTA; i++) {
      const res = await defineField(`field${i}`);
      expect(res.status).toBe(200);
    }

    const overflow = await defineField(`field${QUOTA + 1}`);
    expect(overflow.status).toBe(422);
    const body = (await overflow.json()) as { error: { details: Record<string, unknown> } };
    expect(body.error.details).toMatchObject({
      reason: "cap_exceeded",
      capName: "customFields.fieldDefinition.count",
      limit: QUOTA,
      current: QUOTA,
    });
  });

  test("quota is enforced per tenant", async () => {
    const otherTenantAdmin = createTestUser({
      id: 99,
      tenantId: "00000000-0000-4000-8000-000000000999",
      roles: ["TenantAdmin"],
    });

    for (let i = 1; i <= QUOTA; i++) {
      await defineField(`field${i}`);
    }

    // Other tenant on the same handler — their counter is independent.
    const res = await stack.http.write(
      "custom-fields:write:define-tenant-field",
      {
        entityName: "property",
        fieldKey: "first-on-other-tenant",
        serializedField: { type: "text" },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      otherTenantAdmin,
    );
    expect(res.status).toBe(200);
  });

  test("quota counts include all entity-names for the tenant (not per-entity)", async () => {
    await defineField("field-A");
    await defineField("field-B");
    await defineField("field-C");

    // A different entity-name for the same tenant should still trip the
    // quota — the cap is per-tenant total, not per host entity.
    const res = await stack.http.write(
      "custom-fields:write:define-tenant-field",
      {
        entityName: "different-entity",
        fieldKey: "field-on-different-entity",
        serializedField: { type: "text" },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      admin,
    );
    expect(res.status).toBe(422);
  });
});
