// One custom-fields values projection serves every wired host entity: values
// land in the table of the host that emitted them, and a definition delete
// only strips the key from its own entity's table.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createEntityExecutor,
  createTextField,
  defineEntityListHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId, testUserId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { fieldDefinitionEntity } from "../entity.ts";
import { createCustomFieldsFeature } from "../feature.ts";
import { customFieldsField, wireCustomFieldsFor } from "../wire-for-entity.ts";

const propertyEntity = createEntity({
  name: "property",
  table: "read_hv_properties",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    customFields: customFieldsField(),
  },
});
const unitEntity = createEntity({
  name: "unit",
  table: "read_hv_units",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    customFields: customFieldsField(),
  },
});
const propertyTable = buildEntityTable(propertyEntity);
const unitTable = buildEntityTable(unitEntity);

const estateFeature = defineFeature("estate-hv", (r) => {
  r.entity(propertyEntity);
  r.entity(unitEntity);
  r.requires({ features: ["custom-fields"] });
  wireCustomFieldsFor(r, "property", propertyTable);
  wireCustomFieldsFor(r, "unit", unitTable);

  const { executor: propertyExecutor } = createEntityExecutor(propertyEntity);
  const { executor: unitExecutor } = createEntityExecutor(unitEntity);
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
  r.writeHandler({
    name: "unit:create",
    schema: z.object({ id: z.string(), name: z.string() }),
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) => {
      const payload = event.payload as { id: string; name: string };
      return unitExecutor.create(
        { id: payload.id, name: payload.name, customFields: {} },
        event.user,
        ctx.db,
      );
    },
  });

  r.queryHandler(
    defineEntityListHandler("property", propertyEntity, { access: { roles: ["TenantAdmin"] } }),
  );
  r.queryHandler(
    defineEntityListHandler("unit", unitEntity, { access: { roles: ["TenantAdmin"] } }),
  );
});

let stack: TestStack;

const admin = createTestUser({
  id: testUserId(1),
  tenantId: testTenantId(1),
  roles: ["TenantAdmin"],
});

const PROP_ID = "aaaaaaaa-aaaa-4000-8000-000000000001";
const UNIT_ID = "bbbbbbbb-bbbb-4000-8000-000000000002";

beforeAll(async () => {
  stack = await setupTestStack({ features: [createCustomFieldsFeature(), estateFeature] });
  await unsafeCreateEntityTable(stack.db, fieldDefinitionEntity);
  await unsafeCreateEntityTable(stack.db, propertyEntity);
  await unsafeCreateEntityTable(stack.db, unitEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    eventsTable,
    "read_hv_properties",
    "read_hv_units",
    "read_custom_field_definitions",
  ]);
});

async function defineField(entityName: string, fieldKey: string) {
  return stack.http.writeOk(
    "custom-fields:write:define-tenant-field",
    {
      entityName,
      fieldKey,
      serializedField: { type: "text" },
      required: false,
      searchable: false,
      displayOrder: 0,
    },
    admin,
  );
}

async function setCustomField(entityName: string, entityId: string, value: unknown) {
  return stack.http.writeOk(
    "custom-fields:write:set-custom-field",
    { entityName, entityId, fieldKey: "priority", value },
    admin,
  );
}

async function priorityOf(listQuery: string, id: string): Promise<unknown> {
  const { rows } = (await stack.http.queryOk(listQuery, {}, admin)) as {
    rows: Array<Record<string, unknown>>;
  };
  return rows.find((row) => row["id"] === id)?.["priority"];
}

async function seedValuesOnBothHosts() {
  await defineField("property", "priority");
  await defineField("unit", "priority");
  await stack.http.writeOk(
    "estate-hv:write:property:create",
    { id: PROP_ID, name: "Prop" },
    admin,
  );
  await stack.http.writeOk("estate-hv:write:unit:create", { id: UNIT_ID, name: "Unit" }, admin);
  await setCustomField("property", PROP_ID, "high");
  await setCustomField("unit", UNIT_ID, "low");
  await stack.eventDispatcher?.runOnce();
}

describe("custom-fields host-values projection", () => {
  test("one values projection serves every wired host", () => {
    const customFieldsProjections = [...stack.registry.getAllMultiStreamProjections().keys()].filter(
      (name) => name.includes("custom-fields"),
    );

    expect(customFieldsProjections).toEqual(["custom-fields:projection:host-values"]);
    expect(
      stack.registry.getMultiStreamProjectionFeature("custom-fields:projection:host-values"),
    ).toBe("custom-fields");
  });

  test("a value set on one host lands only in that host's table", async () => {
    await seedValuesOnBothHosts();

    expect(await priorityOf("estate-hv:query:property:list", PROP_ID)).toBe("high");
    expect(await priorityOf("estate-hv:query:unit:list", UNIT_ID)).toBe("low");
  });

  test("deleting one host's definition keeps the other host's values", async () => {
    await seedValuesOnBothHosts();

    await stack.http.writeOk(
      "custom-fields:write:delete-tenant-field",
      { entityName: "property", fieldKey: "priority" },
      admin,
    );
    await stack.eventDispatcher?.runOnce();

    expect(await priorityOf("estate-hv:query:property:list", PROP_ID)).toBeUndefined();
    expect(await priorityOf("estate-hv:query:unit:list", UNIT_ID)).toBe("low");
  });
});
