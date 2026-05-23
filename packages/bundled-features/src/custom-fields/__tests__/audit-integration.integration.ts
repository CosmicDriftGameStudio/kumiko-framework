// T1.5a — Audit cross-feature integration for custom-fields.
//
// Verifies that all custom-field write-actions (define-tenant-field,
// set-custom-field, clear-custom-field, delete-tenant-field) emit events
// that are visible via the `audit:query:list` handler — without any extra
// wiring between the bundles.
//
// The promise: customField writes go through the event-store like any
// other entity write, so the audit-bundle (which queries the events table
// directly) picks them up automatically. This suite is the evidence that
// the promise holds end-to-end.

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
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { AuditQueries } from "../../audit/constants";
import { createAuditFeature } from "../../audit/feature";
import { fieldDefinitionEntity } from "../entity";
import { createCustomFieldsFeature } from "../feature";
import { customFieldsField, wireCustomFieldsFor } from "../wire-for-entity";

const propertyEntity = createEntity({
  table: "read_t15a_properties",
  fields: {
    name: createTextField({ required: true }),
    customFields: customFieldsField(),
  },
});
const propertyTable = buildDrizzleTable("property", propertyEntity);

const propertyFeature = defineFeature("property-t15a", (r) => {
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

// Tenant-admin role for custom-fields handlers + audit. Audit's listQuery
// allows `Admin` and `SystemAdmin`; we add `TenantAdmin` to a single user
// because rotating user-identities mid-test would split the audit trail.
const adminWithAudit = createTestUser({ roles: ["TenantAdmin", "Admin"] });

// Distinct-tenant user for the isolation test — same tenant as `adminWithAudit`
// would defeat the purpose. `TestUsers.otherTenant` is `testTenantId(2)`,
// `adminWithAudit` defaults to `testTenantId(1)` via `TestUsers.admin`.
const otherTenantAdmin = TestUsers.otherTenant;

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [customFieldsFeature, propertyFeature, createAuditFeature()],
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
  await asRawClient(stack.db).unsafe(`DELETE FROM read_t15a_properties`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_custom_field_definitions`);
});

type AuditRow = {
  id: string;
  aggregateId: string;
  aggregateType: string;
  type: string;
  createdBy: string;
  payload: Record<string, unknown>;
};
type AuditResponse = { rows: AuditRow[]; nextBefore: string | null };

async function listAudit(filter: { eventType?: string; aggregateType?: string } = {}) {
  return stack.http.queryOk<AuditResponse>(AuditQueries.list, filter, adminWithAudit);
}

describe("T1.5a: custom-fields events are visible in the audit log", () => {
  test("define-tenant-field emits an event the audit query returns", async () => {
    await stack.http.writeOk(
      "custom-fields:write:define-tenant-field",
      {
        entityName: "property",
        fieldKey: "internalNumber",
        serializedField: { type: "text" },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      adminWithAudit,
    );

    const res = await listAudit({ aggregateType: "field-definition" });

    // The fieldDefinition is created via r.entity + r.crud, so the event-type
    // follows the entity-CRUD convention `<entity>.created` (with a dot),
    // not the feature-emit-via-defineEvent convention used by set/cleared
    // (`custom-fields:event:<short>`).
    const created = res.rows.find((r) => r.type === "field-definition.created");
    expect(created).toBeDefined();
    expect(created?.createdBy).toBe(String(adminWithAudit.id));
    expect(created?.payload["fieldKey"]).toBe("internalNumber");
  });

  test("set-custom-field emits a customField.set event on the host-aggregate stream", async () => {
    const propertyId = "11111111-1111-4000-8000-000000000001";

    await stack.http.writeOk(
      "custom-fields:write:define-tenant-field",
      {
        entityName: "property",
        fieldKey: "internalNumber",
        serializedField: { type: "text" },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      adminWithAudit,
    );
    await stack.http.writeOk(
      "property-t15a:write:property:create",
      { id: propertyId, name: "Hofgarten 12" },
      adminWithAudit,
    );
    await stack.http.writeOk(
      "custom-fields:write:set-custom-field",
      { entityName: "property", entityId: propertyId, fieldKey: "internalNumber", value: "X-42" },
      adminWithAudit,
    );

    const res = await listAudit({ aggregateType: "property" });

    const setEvent = res.rows.find((r) => r.type === "custom-fields:event:custom-field-set");
    expect(setEvent).toBeDefined();
    expect(setEvent?.aggregateId).toBe(propertyId);
    expect(setEvent?.payload["fieldKey"]).toBe("internalNumber");
    expect(setEvent?.payload["value"]).toBe("X-42");
    expect(setEvent?.createdBy).toBe(String(adminWithAudit.id));
  });

  test("clear-custom-field emits a customField.cleared event with the fieldKey", async () => {
    const propertyId = "22222222-2222-4000-8000-000000000002";

    await stack.http.writeOk(
      "custom-fields:write:define-tenant-field",
      {
        entityName: "property",
        fieldKey: "vipFlag",
        serializedField: { type: "boolean" },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      adminWithAudit,
    );
    await stack.http.writeOk(
      "property-t15a:write:property:create",
      { id: propertyId, name: "BookStore" },
      adminWithAudit,
    );
    await stack.http.writeOk(
      "custom-fields:write:set-custom-field",
      { entityName: "property", entityId: propertyId, fieldKey: "vipFlag", value: true },
      adminWithAudit,
    );
    await stack.http.writeOk(
      "custom-fields:write:clear-custom-field",
      { entityName: "property", entityId: propertyId, fieldKey: "vipFlag" },
      adminWithAudit,
    );

    const res = await listAudit({ aggregateType: "property" });

    const clearedEvent = res.rows.find(
      (r) => r.type === "custom-fields:event:custom-field-cleared",
    );
    expect(clearedEvent).toBeDefined();
    expect(clearedEvent?.aggregateId).toBe(propertyId);
    expect(clearedEvent?.payload["fieldKey"]).toBe("vipFlag");
  });

  test("delete-tenant-field emits a fieldDefinition.deleted event", async () => {
    await stack.http.writeOk(
      "custom-fields:write:define-tenant-field",
      {
        entityName: "property",
        fieldKey: "ephemeral",
        serializedField: { type: "text" },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      adminWithAudit,
    );
    await stack.http.writeOk(
      "custom-fields:write:delete-tenant-field",
      { entityName: "property", fieldKey: "ephemeral" },
      adminWithAudit,
    );

    const res = await listAudit({ aggregateType: "field-definition" });

    const deletedEvent = res.rows.find(
      (r) => r.type === "custom-fields:event:field-definition-deleted",
    );
    expect(deletedEvent).toBeDefined();
    expect(deletedEvent?.payload["fieldKey"]).toBe("ephemeral");
    expect(deletedEvent?.payload["entityName"]).toBe("property");
  });

  test("tenant isolation: audit list never returns custom-field events from other tenants", async () => {
    // adminWithAudit is on testTenantId(1), otherTenantAdmin is on
    // testTenantId(2). The field define lands on tenant-1; querying audit
    // as tenant-2's admin must surface zero rows for it. Proves that the
    // existing tenant-isolation in the audit query
    // (`eq(eventsTable.tenantId, query.user.tenantId)`) covers custom-field
    // events too — no extra wiring required.
    expect(adminWithAudit.tenantId).not.toBe(otherTenantAdmin.tenantId);

    await stack.http.writeOk(
      "custom-fields:write:define-tenant-field",
      {
        entityName: "property",
        fieldKey: "leakyField",
        serializedField: { type: "text" },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      adminWithAudit,
    );

    const res = await stack.http.queryOk<AuditResponse>(
      AuditQueries.list,
      { aggregateType: "field-definition" },
      otherTenantAdmin,
    );

    const leak = res.rows.find((r) => (r.payload["fieldKey"] as string) === "leakyField");
    expect(leak).toBeUndefined();
  });
});
