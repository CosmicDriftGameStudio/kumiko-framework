// SystemAdmin audit log across tenants. Real HTTP via setupTestStack — no mocks.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createEntity,
  createTextField,
  defineEntityWriteHandler,
  defineFeature,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  APP_INSTANCE_STREAM_TYPE,
  APP_STARTED_EVENT_TYPE,
  append,
} from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { SYSTEM_TENANT_ID, SYSTEM_USER_ID } from "@cosmicdrift/kumiko-types/identifiers";
import { createConfigFeature } from "../../config/feature.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { createUserFeature } from "../../user/feature.ts";
import { AuditQueries } from "../constants.ts";
import { createAuditFeature } from "../feature.ts";

const widgetEntity = createEntity({
  table: "audit_all_tenants_widgets",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
});

const widgetFeature = defineFeature("audit-all-widgets", (r) => {
  r.entity({ name: "widget", ...widgetEntity });
  r.writeHandler(
    defineEntityWriteHandler("widget:create", widgetEntity, {
      access: { roles: ["Admin", "User", "SystemAdmin", "TenantAdmin"] },
    }),
  );
});

const WIDGET_CREATE = "audit-all-widgets:write:widget:create";

type EventRow = { id: string; tenantId: string; type: string; aggregateId: string };

let stack: TestStack;
const systemAdmin = TestUsers.systemAdmin;
const tenantOne = testTenantId(1);
const tenantTwo = testTenantId(2);
const adminOne: SessionUser = createTestUser({ id: 31, tenantId: tenantOne, roles: ["Admin"] });
const adminTwo: SessionUser = createTestUser({ id: 32, tenantId: tenantTwo, roles: ["Admin"] });
const tenantAdminOne: SessionUser = createTestUser({
  id: 33,
  tenantId: tenantOne,
  roles: ["TenantAdmin"],
});

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      widgetFeature,
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuditFeature(),
    ],
  });
  await unsafeCreateEntityTable(stack.db, widgetEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

let widgetOneId: string;
let widgetTwoId: string;
let foreignSystemStreamId: string;
let appInstanceStreamId: string;

beforeEach(async () => {
  await resetEventStore(stack);
  widgetOneId = (await stack.http.writeOk<{ id: string }>(WIDGET_CREATE, { name: "a" }, adminOne))
    .id;
  widgetTwoId = (await stack.http.writeOk<{ id: string }>(WIDGET_CREATE, { name: "b" }, adminTwo))
    .id;
  foreignSystemStreamId = generateId();
  appInstanceStreamId = generateId();
  for (const [aggregateId, aggregateType] of [
    [foreignSystemStreamId, "session-revocation"],
    [appInstanceStreamId, APP_INSTANCE_STREAM_TYPE],
  ] as const) {
    await append(stack.db, {
      aggregateId,
      aggregateType,
      tenantId: SYSTEM_TENANT_ID,
      expectedVersion: 0,
      type: APP_STARTED_EVENT_TYPE,
      payload: { version: "1", instanceId: "t", startedAt: "2026-01-01T00:00:00Z" },
      metadata: { userId: SYSTEM_USER_ID },
    });
  }
});

describe("audit:query:list-all-tenants", () => {
  test("SystemAdmin sees the events of both tenants, each row with its tenantId", async () => {
    const res = await stack.http.queryOk<{ rows: readonly EventRow[] }>(
      AuditQueries.listAllTenants,
      {},
      systemAdmin,
    );
    const byAggregate = new Map(res.rows.map((r) => [r.aggregateId, r.tenantId]));
    expect(byAggregate.get(widgetOneId)).toBe(tenantOne);
    expect(byAggregate.get(widgetTwoId)).toBe(tenantTwo);
  });

  test("the tenant filter narrows to the chosen tenants", async () => {
    const res = await stack.http.queryOk<{ rows: readonly EventRow[] }>(
      AuditQueries.listAllTenants,
      { filters: [{ field: "tenantId", op: "in", value: [tenantTwo] }] },
      systemAdmin,
    );
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.every((r) => r.tenantId === tenantTwo)).toBe(true);
  });

  test("naming the system tenant in the filter yields nothing", async () => {
    const res = await stack.http.queryOk<{ rows: readonly EventRow[] }>(
      AuditQueries.listAllTenants,
      { filters: [{ field: "tenantId", op: "in", value: [SYSTEM_TENANT_ID] }] },
      systemAdmin,
    );
    expect(res.rows).toEqual([]);
  });

  test("system-tenant streams stay out, personal ones and app-instance ones alike", async () => {
    const res = await stack.http.queryOk<{ rows: readonly EventRow[] }>(
      AuditQueries.listAllTenants,
      {},
      systemAdmin,
    );
    const aggregateIds = res.rows.map((r) => r.aggregateId);
    expect(aggregateIds).not.toContain(foreignSystemStreamId);
    expect(aggregateIds).not.toContain(appInstanceStreamId);
    expect(res.rows.some((r) => r.tenantId === SYSTEM_TENANT_ID)).toBe(false);
  });

  test("a filter other than tenantId in is rejected", async () => {
    const res = await stack.http.query(
      AuditQueries.listAllTenants,
      { filters: [{ field: "createdBy", op: "in", value: [tenantOne] }] },
      systemAdmin,
    );
    expect(res.status).toBe(400);
  });

  test("Admin and TenantAdmin get 403", async () => {
    for (const user of [adminOne, tenantAdminOne]) {
      const res = await stack.http.query(AuditQueries.listAllTenants, {}, user);
      expect(res.status).toBe(403);
    }
  });
});

describe("audit:query:details-all-tenants", () => {
  async function eventIdOf(aggregateId: string): Promise<string> {
    const res = await stack.http.queryOk<{ rows: readonly EventRow[] }>(
      AuditQueries.listAllTenants,
      {},
      systemAdmin,
    );
    const row = res.rows.find((r) => r.aggregateId === aggregateId);
    if (!row) throw new Error("event missing");
    return row.id;
  }

  test("SystemAdmin reads an event of another tenant including its tenantId", async () => {
    const details = await stack.http.queryOk<EventRow | null>(
      AuditQueries.detailsAllTenants,
      { id: await eventIdOf(widgetTwoId) },
      systemAdmin,
    );
    expect(details?.tenantId).toBe(tenantTwo);
    expect(details?.aggregateId).toBe(widgetTwoId);
  });

  test("a system-tenant event is not readable through it", async () => {
    const own = await stack.http.queryOk<{ rows: readonly EventRow[] }>(
      AuditQueries.list,
      { scope: "system" },
      systemAdmin,
    );
    const systemEvent = own.rows.find((r) => r.aggregateId === appInstanceStreamId);
    if (!systemEvent) throw new Error("system event missing");
    const details = await stack.http.queryOk<EventRow | null>(
      AuditQueries.detailsAllTenants,
      { id: systemEvent.id },
      systemAdmin,
    );
    expect(details).toBeNull();
  });

  test("Admin gets 403", async () => {
    const id = await eventIdOf(widgetTwoId);
    const res = await stack.http.query(AuditQueries.detailsAllTenants, { id }, adminOne);
    expect(res.status).toBe(403);
  });
});
