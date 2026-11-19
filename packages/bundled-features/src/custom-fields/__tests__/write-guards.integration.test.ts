// Write guards: definitions and values are only accepted for entities wired
// with wireCustomFieldsFor, and value writes resolve system-tenant definitions.

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
import { createProjectionStateTable } from "@cosmicdrift/kumiko-framework/pipeline";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
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
  table: "read_cf_write_guard_properties",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    customFields: customFieldsField(),
  },
});
const propertyTable = buildEntityTable(propertyEntity);

const plainNoteEntity = createEntity({
  name: "plain-note",
  table: "read_cf_write_guard_notes",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
});

const propertyFeature = defineFeature("property-write-guards", (r) => {
  r.entity(propertyEntity);
  r.entity(plainNoteEntity);
  r.requires({ features: ["custom-fields"] });
  wireCustomFieldsFor(r, "property", propertyTable);

  const { executor: propertyExecutor } = createEntityExecutor(propertyEntity);
  r.writeHandler({
    name: "property:create",
    schema: z.object({ id: z.string(), name: z.string() }),
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) =>
      propertyExecutor.create(
        { id: event.payload.id, name: event.payload.name, customFields: {} },
        event.user,
        ctx.db,
      ),
  });
  r.queryHandler(
    defineEntityListHandler("property", propertyEntity, { access: { roles: ["TenantAdmin"] } }),
  );
});

const admin = createTestUser({ roles: ["TenantAdmin"] });
const systemAdmin = createTestUser({ roles: ["SystemAdmin"] });
const PROPERTY_ID = "11111111-1111-4000-8000-000000000001";
const ANY_ID = "22222222-2222-4000-8000-000000000002";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createCustomFieldsFeature(), propertyFeature] });
  await unsafeCreateEntityTable(stack.db, fieldDefinitionEntity);
  await unsafeCreateEntityTable(stack.db, propertyEntity);
  await unsafeCreateEntityTable(stack.db, plainNoteEntity);
  await createProjectionStateTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    eventsTable,
    "read_cf_write_guard_properties",
    "read_custom_field_definitions",
  ]);
});

function definePayload(entityName: string, fieldKey: string) {
  return {
    entityName,
    fieldKey,
    serializedField: { type: "text" },
    required: false,
    searchable: false,
    displayOrder: 0,
  };
}

describe("custom-fields only on wired host entities", () => {
  test("define-tenant-field rejects an entity that is not wired", async () => {
    const err = await stack.http.writeErr(
      "custom-fields:write:define-tenant-field",
      definePayload("plain-note", "tag"),
      admin,
    );
    expect(err.code).toBe("unprocessable");
    expect(err.details).toMatchObject({ reason: "custom_fields_entity_not_wired" });
  });

  test("define-system-field rejects an entity that is not wired", async () => {
    const err = await stack.http.writeErr(
      "custom-fields:write:define-system-field",
      definePayload("plain-note", "tag"),
      systemAdmin,
    );
    expect(err.code).toBe("unprocessable");
    expect(err.details).toMatchObject({ reason: "custom_fields_entity_not_wired" });
  });

  test("set-custom-field and clear-custom-field reject an entity that is not wired", async () => {
    const setErr = await stack.http.writeErr(
      "custom-fields:write:set-custom-field",
      { entityName: "plain-note", entityId: ANY_ID, fieldKey: "tag", value: "x" },
      admin,
    );
    expect(setErr.code).toBe("unprocessable");
    expect(setErr.details).toMatchObject({ reason: "custom_fields_entity_not_wired" });

    const clearErr = await stack.http.writeErr(
      "custom-fields:write:clear-custom-field",
      { entityName: "plain-note", entityId: ANY_ID, fieldKey: "tag" },
      admin,
    );
    expect(clearErr.code).toBe("unprocessable");
    expect(clearErr.details).toMatchObject({ reason: "custom_fields_entity_not_wired" });
  });
});

describe("definition lookup on value writes", () => {
  test("a tenant can set a value for a system-tenant definition", async () => {
    await stack.http.writeOk(
      "custom-fields:write:define-system-field",
      definePayload("property", "vendorTag"),
      systemAdmin,
    );
    await stack.http.writeOk(
      "property-write-guards:write:property:create",
      { id: PROPERTY_ID, name: "Hofgarten" },
      admin,
    );
    await stack.http.writeOk(
      "custom-fields:write:set-custom-field",
      { entityName: "property", entityId: PROPERTY_ID, fieldKey: "vendorTag", value: "acme" },
      admin,
    );
    await stack.eventDispatcher?.runOnce();

    const list = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      "property-write-guards:query:property:list",
      {},
      admin,
    );
    expect(list.rows.find((row) => row["id"] === PROPERTY_ID)?.["vendorTag"]).toBe("acme");
  });

  test("a deleted definition is not found on value writes", async () => {
    await stack.http.writeOk(
      "custom-fields:write:define-tenant-field",
      definePayload("property", "stage"),
      admin,
    );
    await stack.http.writeOk(
      "property-write-guards:write:property:create",
      { id: PROPERTY_ID, name: "Hofgarten" },
      admin,
    );
    await stack.http.writeOk(
      "custom-fields:write:delete-tenant-field",
      { entityName: "property", fieldKey: "stage" },
      admin,
    );

    const err = await stack.http.writeErr(
      "custom-fields:write:set-custom-field",
      { entityName: "property", entityId: PROPERTY_ID, fieldKey: "stage", value: "x" },
      admin,
    );
    expect(err.code).toBe("not_found");
  });
});
