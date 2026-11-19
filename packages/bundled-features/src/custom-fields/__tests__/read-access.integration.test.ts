// Read gate and searchable flag of custom fields, through the real stack:
// postQuery output is filtered by fieldAccess.read, the search index only
// receives searchable fields without a read restriction.

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
import { reindexEntity } from "@cosmicdrift/kumiko-framework/search";
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
  table: "read_cf_read_access_properties",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    customFields: customFieldsField(),
  },
});
const propertyTable = buildEntityTable(propertyEntity);

const propertyFeature = defineFeature("property-read-access", (r) => {
  r.entity(propertyEntity);
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
    defineEntityListHandler("property", propertyEntity, {
      access: { roles: ["TenantAdmin", "Viewer"] },
    }),
  );
});

const admin = createTestUser({ roles: ["TenantAdmin"] });
const viewer = createTestUser({ roles: ["Viewer"] });
const PROPERTY_ID = "11111111-1111-4000-8000-000000000001";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createCustomFieldsFeature(), propertyFeature],
    searchConfig: { tenantId: admin.tenantId, searchableFields: [], rankingFields: [] },
  });
  await unsafeCreateEntityTable(stack.db, fieldDefinitionEntity);
  await unsafeCreateEntityTable(stack.db, propertyEntity);
  await createProjectionStateTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    eventsTable,
    "read_cf_read_access_properties",
    "read_custom_field_definitions",
  ]);
});

async function defineField(
  fieldKey: string,
  serializedField: Record<string, unknown>,
  searchable = false,
) {
  await stack.http.writeOk(
    "custom-fields:write:define-tenant-field",
    {
      entityName: "property",
      fieldKey,
      serializedField,
      required: false,
      searchable,
      displayOrder: 0,
    },
    admin,
  );
}

async function setField(fieldKey: string, value: unknown) {
  await stack.http.writeOk(
    "custom-fields:write:set-custom-field",
    { entityName: "property", entityId: PROPERTY_ID, fieldKey, value },
    admin,
  );
}

async function createProperty() {
  await stack.http.writeOk(
    "property-read-access:write:property:create",
    { id: PROPERTY_ID, name: "Hofgarten" },
    admin,
  );
}

async function listAs(user: typeof admin) {
  const result = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "property-read-access:query:property:list",
    {},
    user,
  );
  return result.rows.find((row) => row["id"] === PROPERTY_ID);
}

describe("custom-fields read gate", () => {
  test("read-restricted field is hidden from roles outside fieldAccess.read", async () => {
    await defineField("color", { type: "text" });
    await defineField("internalNote", { type: "text", fieldAccess: { read: ["TenantAdmin"] } });
    await defineField("publicTag", { type: "text", fieldAccess: { read: ["anonymous"] } });
    await createProperty();
    await setField("color", "blue");
    await setField("internalNote", "secret");
    await setField("publicTag", "open");
    await stack.eventDispatcher?.runOnce();

    const viewerRow = await listAs(viewer);
    expect(viewerRow?.["color"]).toBe("blue");
    expect(viewerRow?.["publicTag"]).toBe("open");
    expect(viewerRow?.["internalNote"]).toBeUndefined();
    expect(viewerRow?.["customFields"]).toEqual({ color: "blue", publicTag: "open" });

    const adminRow = await listAs(admin);
    expect(adminRow?.["color"]).toBe("blue");
    expect(adminRow?.["internalNote"]).toBe("secret");
  });

  test("base column wins over a custom field with the same key", async () => {
    await defineField("name", { type: "text" });
    await createProperty();
    await setField("name", "shadow");
    await stack.eventDispatcher?.runOnce();

    const row = await listAs(admin);
    expect(row?.["name"]).toBe("Hofgarten");
  });
});

describe("custom-fields search index", () => {
  test("search indexes only searchable fields without read restriction", async () => {
    await defineField("color", { type: "text" }, true);
    await defineField("internalCode", { type: "text" }, false);
    await defineField("secretTag", { type: "text", fieldAccess: { read: ["TenantAdmin"] } }, true);
    await createProperty();
    await setField("color", "blue-zebra");
    await setField("internalCode", "code-quokka");
    await setField("secretTag", "tag-ocelot");
    await stack.eventDispatcher?.runOnce();

    await reindexEntity(stack.db, stack.registry, stack.search, "property", admin.tenantId);

    const search = (term: string) =>
      stack.search.search(admin.tenantId, term, { filterType: "property" });
    const zebra = await search("zebra");
    expect(zebra.map((hit) => String(hit.entityId))).toEqual([PROPERTY_ID]);
    expect(await search("quokka")).toHaveLength(0);
    expect(await search("ocelot")).toHaveLength(0);
  });
});
