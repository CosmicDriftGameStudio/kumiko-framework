// T1.5d — per-field retention sweep.
//
// `runCustomFieldsRetention(opts)` walks the host entity's rows, looks up
// every fieldDefinition with a `retention` policy, and strips/nulls
// customField values whose host row's `modified_at` is older than the
// policy's `keepFor`. Strategy `delete` removes the key; `anonymize`
// nulls it in place.
//
// The reference timestamp is the host row's `modified_at`, not a per-key
// timestamp — see run-retention.ts header for the rationale.

import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
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
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { fieldDefinitionEntity } from "../entity";
import { createCustomFieldsFeature } from "../feature";
import { runCustomFieldsRetention } from "../run-retention";
import { customFieldsField, wireCustomFieldsFor } from "../wire-for-entity";

const propertyEntity = createEntity({
  table: "read_t15d_properties",
  fields: {
    name: createTextField({ required: true }),
    customFields: customFieldsField(),
  },
});
const propertyTable = buildDrizzleTable("property", propertyEntity);

const propertyFeature = defineFeature("property-t15d", (r) => {
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

const customFieldsFeature = createCustomFieldsFeature();
const admin = createTestUser({ id: 1, roles: ["TenantAdmin"] });

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
  await asRawClient(stack.db).unsafe(`DELETE FROM read_t15d_properties`);
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
  return stack.http.writeOk("property-t15d:write:property:create", { id, name }, admin);
}

async function setField(entityId: string, fieldKey: string, value: unknown) {
  return stack.http.writeOk(
    "custom-fields:write:set-custom-field",
    { entityName: "property", entityId, fieldKey, value },
    admin,
  );
}

// Time-travel: backdate the host row's modified_at so the row "looks"
// older than the retention cutoff. Faster than waiting `keepFor` real
// time and the cleanest way to drive the cron under test.
async function backdateRow(id: string, isoOlderThan: string) {
  await asRawClient(stack.db).unsafe(
    `UPDATE read_t15d_properties SET modified_at = $1::timestamptz WHERE id = $2`,
    [isoOlderThan, id],
  );
}

async function readRow(id: string): Promise<Record<string, unknown> | undefined> {
  const rows = await asRawClient(stack.db).unsafe(
    `SELECT id, custom_fields FROM read_t15d_properties WHERE id = $1`,
    [id],
  );
  return (rows as ReadonlyArray<Record<string, unknown>>)[0];
}

const T = getTemporal();
const NOW = T.Instant.from("2026-05-23T10:00:00Z");

describe("T1.5d: per-field retention sweep", () => {
  test("delete-strategy: expired key is stripped from the customFields jsonb", async () => {
    const propertyId = "11111111-1111-4000-8000-000000000001";
    await defineField("temp", {
      type: "text",
      retention: { keepFor: "30d", strategy: "delete" },
    });
    await createProperty(propertyId, "WillExpire");
    await setField(propertyId, "temp", "soon-gone");
    await stack.eventDispatcher?.runOnce();

    // 31 days ago — past the 30d cutoff.
    await backdateRow(propertyId, "2026-04-22T10:00:00Z");

    const report = await runCustomFieldsRetention({
      db: stack.db,
      tenantId: admin.tenantId,
      entityName: "property",
      entityTable: propertyTable,
      now: NOW,
    });

    expect(report.rowsUpdated).toBe(1);
    expect(report.removalsByFieldKey).toEqual({ temp: 1 });
    const row = await readRow(propertyId);
    expect(row?.["custom_fields"]).not.toHaveProperty("temp");
  });

  test("anonymize-strategy: expired key value is set to null, key stays", async () => {
    const propertyId = "22222222-2222-4000-8000-000000000002";
    await defineField("auditTrail", {
      type: "text",
      retention: { keepFor: "30d", strategy: "anonymize" },
    });
    await createProperty(propertyId, "Anonymize");
    await setField(propertyId, "auditTrail", "user@example.com");
    await stack.eventDispatcher?.runOnce();

    await backdateRow(propertyId, "2026-04-22T10:00:00Z");

    await runCustomFieldsRetention({
      db: stack.db,
      tenantId: admin.tenantId,
      entityName: "property",
      entityTable: propertyTable,
      now: NOW,
    });

    const row = await readRow(propertyId);
    const cf = row?.["custom_fields"] as Record<string, unknown>;
    expect(cf).toHaveProperty("auditTrail");
    expect(cf["auditTrail"]).toBeNull();
  });

  test("not yet expired: key untouched", async () => {
    const propertyId = "33333333-3333-4000-8000-000000000003";
    await defineField("recent", {
      type: "text",
      retention: { keepFor: "30d", strategy: "delete" },
    });
    await createProperty(propertyId, "StillFresh");
    await setField(propertyId, "recent", "keep-me");
    await stack.eventDispatcher?.runOnce();

    // 10 days ago — well inside 30d.
    await backdateRow(propertyId, "2026-05-13T10:00:00Z");

    await runCustomFieldsRetention({
      db: stack.db,
      tenantId: admin.tenantId,
      entityName: "property",
      entityTable: propertyTable,
      now: NOW,
    });

    const row = await readRow(propertyId);
    expect((row?.["custom_fields"] as Record<string, unknown>)["recent"]).toBe("keep-me");
  });

  test("field without retention policy: untouched even on ancient rows", async () => {
    const propertyId = "44444444-4444-4000-8000-000000000004";
    await defineField("forever", { type: "text" });
    await createProperty(propertyId, "NoPolicy");
    await setField(propertyId, "forever", "keep-me-always");
    await stack.eventDispatcher?.runOnce();

    // 5 years ago.
    await backdateRow(propertyId, "2021-05-23T10:00:00Z");

    const report = await runCustomFieldsRetention({
      db: stack.db,
      tenantId: admin.tenantId,
      entityName: "property",
      entityTable: propertyTable,
      now: NOW,
    });

    expect(report.rowsUpdated).toBe(0);
    const row = await readRow(propertyId);
    expect((row?.["custom_fields"] as Record<string, unknown>)["forever"]).toBe("keep-me-always");
  });

  test("mixed: only expired-with-policy keys are stripped, others stay", async () => {
    const propertyId = "55555555-5555-4000-8000-000000000005";
    await defineField("temp", {
      type: "text",
      retention: { keepFor: "30d", strategy: "delete" },
    });
    await defineField("keepThis", { type: "text" });
    await createProperty(propertyId, "Mixed");
    await setField(propertyId, "temp", "should-go");
    await setField(propertyId, "keepThis", "should-stay");
    await stack.eventDispatcher?.runOnce();

    await backdateRow(propertyId, "2026-04-22T10:00:00Z");

    await runCustomFieldsRetention({
      db: stack.db,
      tenantId: admin.tenantId,
      entityName: "property",
      entityTable: propertyTable,
      now: NOW,
    });

    const cf = (await readRow(propertyId))?.["custom_fields"] as Record<string, unknown>;
    expect(cf).not.toHaveProperty("temp");
    expect(cf["keepThis"]).toBe("should-stay");
  });
});
