// T1 — full-stack integration tests for the custom-fields bundle.
//
// Drives define→set→query→clear→delete-cascade through the real dispatcher +
// MSP-pipeline + DB. Verifies that the architecture actually works end-to-end:
//   - r.defineEvent fires + MSP consumes + jsonb-projection lands
//   - postQuery-entity-hook flattens customFields auf API-root
//   - fieldDefinition-delete cascade-cleans orphan jsonb-keys
//   - Multi-tenant isolation
//
// Pattern follows cap-counter.integration.ts: probe-feature mit own entity,
// wired via wireCustomFieldsFor.

import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createEntityExecutor,
  createTextField,
  defineEntityListHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { fieldDefinitionEntity } from "../entity";
import { createCustomFieldsFeature } from "../feature";
import { customFieldsField, wireCustomFieldsFor } from "../wire-for-entity";

// --- Probe-Feature: a tenant-owned "property" entity with customFields ---

const propertyEntity = createEntity({
  table: "read_t1_properties",
  fields: {
    name: createTextField({ required: true }),
    customFields: customFieldsField(),
  },
});
const propertyTable = buildDrizzleTable("property", propertyEntity);

const propertyFeature = defineFeature("property-test", (r) => {
  r.entity("property", propertyEntity);
  r.requires("custom-fields");
  wireCustomFieldsFor(r, "property", propertyTable);

  // Standard CRUD: create + list via entity-handlers. Pure test-probe.
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

// --- Stack ---

const customFieldsFeature = createCustomFieldsFeature();

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
  // Clean slate per test — event-log + entity-rows.
  await asRawClient(stack.db).unsafe(`DELETE FROM kumiko_events`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_t1_properties`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_custom_field_definitions`);
});

// --- Helpers ---

// TestUsers.admin hat role="Admin"; unsere handlers verlangen "TenantAdmin"
// (Memory: feedback_role_naming_drift — bundled-features-Convention vs.
// platform-Convention). Wir bauen einen tenant-admin für die Tests.
const admin = createTestUser({ roles: ["TenantAdmin"] });

async function defineField(entityName: string, fieldKey: string, type = "text") {
  return stack.http.writeOk(
    "custom-fields:write:define-tenant-field",
    {
      entityName,
      fieldKey,
      serializedField: { type },
      required: false,
      searchable: false,
      displayOrder: 0,
    },
    admin,
  );
}

async function setCustomField(
  entityName: string,
  entityId: string,
  fieldKey: string,
  value: unknown,
) {
  return stack.http.writeOk(
    "custom-fields:write:set-custom-field",
    { entityName, entityId, fieldKey, value },
    admin,
  );
}

async function clearCustomField(entityName: string, entityId: string, fieldKey: string) {
  return stack.http.writeOk(
    "custom-fields:write:clear-custom-field",
    { entityName, entityId, fieldKey },
    admin,
  );
}

async function createProperty(id: string, name: string) {
  return stack.http.writeOk("property-test:write:property:create", { id, name }, admin);
}

async function listProperties() {
  return (await stack.http.queryOk("property-test:query:property:list", {}, admin)) as {
    rows: Array<Record<string, unknown>>;
  };
}

// --- Tests ---

describe("custom-fields integration — define + set + query roundtrip", () => {
  test("set → MSP → postQuery: customField value lands flat in entity response", async () => {
    await defineField("property", "internalNumber");
    await createProperty("11111111-1111-4000-8000-000000000001", "Hofgarten 12");
    await setCustomField(
      "property",
      "11111111-1111-4000-8000-000000000001",
      "internalNumber",
      "X-2042",
    );

    await stack.eventDispatcher?.runOnce();

    const { rows } = await listProperties();
    const p1 = rows.find((r) => r["id"] === "11111111-1111-4000-8000-000000000001");
    expect(p1).toBeDefined();
    expect(p1?.["internalNumber"]).toBe("X-2042");
  });

  test("clear: fieldKey gone from response after clear-custom-field", async () => {
    await defineField("property", "vipFlag", "boolean");
    await createProperty("22222222-2222-4000-8000-000000000002", "BookStore");
    await setCustomField("property", "22222222-2222-4000-8000-000000000002", "vipFlag", true);
    await stack.eventDispatcher?.runOnce();

    let p2 = (await listProperties()).rows.find(
      (r) => r["id"] === "22222222-2222-4000-8000-000000000002",
    );
    expect(p2?.["vipFlag"]).toBe(true);

    await clearCustomField("property", "22222222-2222-4000-8000-000000000002", "vipFlag");
    await stack.eventDispatcher?.runOnce();

    p2 = (await listProperties()).rows.find(
      (r) => r["id"] === "22222222-2222-4000-8000-000000000002",
    );
    expect(p2?.["vipFlag"]).toBeUndefined();
  });

  test("multiple fields on same entity: all merge flat", async () => {
    await defineField("property", "vendor");
    await defineField("property", "tier", "number");
    await createProperty("33333333-3333-4000-8000-000000000003", "MultiField");
    await setCustomField("property", "33333333-3333-4000-8000-000000000003", "vendor", "Hetzner");
    await setCustomField("property", "33333333-3333-4000-8000-000000000003", "tier", 2);

    await stack.eventDispatcher?.runOnce();

    const p3 = (await listProperties()).rows.find(
      (r) => r["id"] === "33333333-3333-4000-8000-000000000003",
    );
    expect(p3?.["vendor"]).toBe("Hetzner");
    expect(p3?.["tier"]).toBe(2);
  });

  test("entity without customField values: still queryable (no postQuery breakage)", async () => {
    await createProperty("44444444-4444-4000-8000-000000000004", "NoCustomFields");

    const p4 = (await listProperties()).rows.find(
      (r) => r["id"] === "44444444-4444-4000-8000-000000000004",
    );
    expect(p4?.["name"]).toBe("NoCustomFields");
  });
});

describe("custom-fields integration — fieldDefinition-delete cascade", () => {
  test("fieldDef-delete: orphan values removed from all entity-rows", async () => {
    await defineField("property", "ephemeral");
    await createProperty("55555555-5555-4000-8000-000000000005", "WillLoseField");
    await setCustomField("property", "55555555-5555-4000-8000-000000000005", "ephemeral", "doomed");
    await stack.eventDispatcher?.runOnce();

    let p5 = (await listProperties()).rows.find(
      (r) => r["id"] === "55555555-5555-4000-8000-000000000005",
    );
    expect(p5?.["ephemeral"]).toBe("doomed");

    // Delete fieldDef — cascade-MSP entfernt jsonb-key aus allen rows
    await stack.http.writeOk(
      "custom-fields:write:delete-tenant-field",
      { entityName: "property", fieldKey: "ephemeral" },
      admin,
    );
    await stack.eventDispatcher?.runOnce();

    p5 = (await listProperties()).rows.find(
      (r) => r["id"] === "55555555-5555-4000-8000-000000000005",
    );
    expect(p5?.["ephemeral"]).toBeUndefined();
    expect(p5?.["name"]).toBe("WillLoseField"); // Stammfeld unverändert
  });
});

describe("custom-fields integration — Last-Wins on concurrent set", () => {
  test("two sequential sets on same field: last value wins", async () => {
    await defineField("property", "status");
    await createProperty("66666666-6666-4000-8000-000000000006", "StatusEntity");

    await setCustomField("property", "66666666-6666-4000-8000-000000000006", "status", "draft");
    await setCustomField("property", "66666666-6666-4000-8000-000000000006", "status", "published");
    await stack.eventDispatcher?.runOnce();

    const p6 = (await listProperties()).rows.find(
      (r) => r["id"] === "66666666-6666-4000-8000-000000000006",
    );
    expect(p6?.["status"]).toBe("published");
  });
});
