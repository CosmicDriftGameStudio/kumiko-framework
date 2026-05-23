// Custom-Fields Basic — integration test.
//
// Proves the full define → set → read roundtrip via the real dispatcher,
// MSP-pipeline and DB:
//   1. tenant defines `internalNumber` on `property`
//   2. property is created
//   3. customField is set → MSP writes into jsonb
//   4. list-query returns the value flattened onto the row
//
// This is the smallest evidence that wireCustomFieldsFor + the bundle's
// projection-hook + entity-postQuery flattening all line up.

import {
  createCustomFieldsFeature,
  fieldDefinitionEntity,
} from "@cosmicdrift/kumiko-bundled-features/custom-fields";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { propertyEntity, propertyFeature } from "../feature";

const admin = createTestUser({ roles: ["TenantAdmin"] });
const customFields = createCustomFieldsFeature();

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [customFields, propertyFeature] });
  await unsafeCreateEntityTable(stack.db, fieldDefinitionEntity);
  await unsafeCreateEntityTable(stack.db, propertyEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.execute(sql`DELETE FROM kumiko_events`);
  await stack.db.execute(sql`DELETE FROM read_sample_cf_properties`);
  await stack.db.execute(sql`DELETE FROM read_custom_field_definitions`);
});

async function defineField(fieldKey: string, type = "text") {
  return stack.http.writeOk(
    "custom-fields:write:define-tenant-field",
    {
      entityName: "property",
      fieldKey,
      serializedField: { type },
      required: false,
      searchable: false,
      displayOrder: 0,
    },
    admin,
  );
}

async function setField(entityId: string, fieldKey: string, value: unknown) {
  return stack.http.writeOk(
    "custom-fields:write:set-custom-field",
    { entityName: "property", entityId, fieldKey, value },
    admin,
  );
}

async function listProperties() {
  return (await stack.http.queryOk("property-management:query:property:list", {}, admin)) as {
    rows: Array<Record<string, unknown>>;
  };
}

describe("custom-fields-basic recipe — define + set + read", () => {
  test("tenant-defined field lands flat on the entity response", async () => {
    const id = "11111111-1111-4000-8000-000000000001";

    await defineField("internalNumber");
    await stack.http.writeOk(
      "property-management:write:property:create",
      { id, name: "Hofgarten 12" },
      admin,
    );
    await setField(id, "internalNumber", "X-2042");
    await stack.eventDispatcher?.runOnce();

    const { rows } = await listProperties();
    const property = rows.find((row) => row["id"] === id);
    expect(property?.["internalNumber"]).toBe("X-2042");
  });

  test("typed field: number value preserves its type", async () => {
    const id = "22222222-2222-4000-8000-000000000002";

    await defineField("tier", "number");
    await stack.http.writeOk(
      "property-management:write:property:create",
      { id, name: "MultiField" },
      admin,
    );
    await setField(id, "tier", 2);
    await stack.eventDispatcher?.runOnce();

    const property = (await listProperties()).rows.find((row) => row["id"] === id);
    expect(property?.["tier"]).toBe(2);
  });
});
