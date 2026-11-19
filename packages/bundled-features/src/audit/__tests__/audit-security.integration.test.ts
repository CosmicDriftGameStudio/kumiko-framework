// Security integration tests for audit-log HTTP surface.
// Real HTTP via setupTestStack — no mocks.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createEmbeddedField,
  createEmbeddedListField,
  createEntity,
  createEntityExecutor,
  createTextField,
  defineEntityCreateHandler,
  defineEntityUpdateHandler,
  defineFeature,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  APP_INSTANCE_STREAM_TYPE,
  APP_STARTED_EVENT_TYPE,
  append,
  eventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { rolesOf } from "@cosmicdrift/kumiko-testing/helpers";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { SYSTEM_TENANT_ID, SYSTEM_USER_ID } from "@cosmicdrift/kumiko-types/identifiers";
import * as z from "zod";
import { createConfigFeature } from "../../config/feature.ts";
import { hashPassword } from "../../shared/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { seedTenant, seedTenantMembership } from "../../tenant/seeding.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity } from "../../user/schema/user.ts";
import { seedUser } from "../../user/seeding.ts";
import { createAuditFeature } from "../feature.ts";
import { AUDIT_LOG_SCREEN_ID, AuditQueries, AuditScopes } from "../web/constants.ts";

const widgetEntity = createEntity({
  name: "widget",
  table: "audit_sec_widgets",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
});

const widgetFeature = defineFeature("audit-sec-widgets", (r) => {
  r.entity(widgetEntity);
  r.writeHandler(
    defineEntityCreateHandler("widget", widgetEntity, {
      access: { roles: ["Admin", "User", "SystemAdmin", "TenantAdmin"] },
    }),
  );
});

const dossierEntity = createEntity({
  name: "dossier",
  table: "audit_sec_dossiers",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
  access: { read: { HR: "all" } },
});

const memoEntity = createEntity({
  name: "memo",
  table: "audit_sec_memos",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    salary: createTextField({
      personal: false,
      reason: "technical_reference",
      access: { read: ["HR"] },
    }),
    pin: createTextField({ personal: "tenant", find: "secret", writeOnly: true }),
    bonus: createEmbeddedField(
      { amount: { type: "text", access: { read: ["HR"] } } },
      { personal: false, reason: "technical_reference" },
    ),
    reviews: createEmbeddedListField(
      { note: { type: "text", access: { read: ["HR"] } } },
      { personal: false, reason: "technical_reference" },
    ),
  },
  verbs: { reviewed: {} },
});

const restrictedHandlerAccess = { access: { roles: ["HR", "TenantAdmin"] } };

const restrictedFeature = defineFeature("audit-sec-restricted", (r) => {
  r.entity(dossierEntity);
  r.entity(memoEntity);
  r.writeHandler(defineEntityCreateHandler("dossier", dossierEntity, restrictedHandlerAccess));
  r.writeHandler(defineEntityCreateHandler("memo", memoEntity, restrictedHandlerAccess));
  r.writeHandler(defineEntityUpdateHandler("memo", memoEntity, restrictedHandlerAccess));
  const { executor: memoExecutor } = createEntityExecutor(memoEntity);
  r.writeHandler({
    name: "memo:review",
    schema: z.object({ id: z.uuid(), salary: z.string() }),
    handler: async (event, ctx) =>
      memoExecutor.update(
        { id: event.payload.id, changes: { salary: event.payload.salary } },
        event.user,
        ctx.db,
        { skipOptimisticLock: true, verb: "reviewed" },
      ),
    ...restrictedHandlerAccess,
  });
});

let stack: TestStack;
let TENANT_ID: TenantId;
let tenantAdminId: string;
let hrAdminId: string;

const systemAdmin = TestUsers.systemAdmin;

function tenantAdmin(): SessionUser {
  return { id: tenantAdminId, tenantId: TENANT_ID, roles: ["TenantAdmin"] };
}

function hrTenantAdmin(): SessionUser {
  return { id: hrAdminId, tenantId: TENANT_ID, roles: ["TenantAdmin", "HR"] };
}

function regularUser(): SessionUser {
  return createTestUser({ id: 42, tenantId: TENANT_ID, roles: ["User"] });
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      widgetFeature,
      restrictedFeature,
      createAuditFeature(),
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, widgetEntity);
  await unsafeCreateEntityTable(stack.db, dossierEntity);
  await unsafeCreateEntityTable(stack.db, memoEntity);
  await unsafePushTables(stack.db, { tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack, ["audit_sec_widgets", "audit_sec_dossiers", "audit_sec_memos"]);
  TENANT_ID = testTenantId(1);
  await seedTenant(stack.db, { id: TENANT_ID, key: "audit-sec", name: "Audit Sec" });
  ({ id: tenantAdminId } = await seedUser(stack.db, {
    email: "taudit@example.com",
    displayName: "TAudit",
    passwordHash: await hashPassword("pw-audit-1234"),
    emailVerified: true,
  }));
  await seedTenantMembership(stack.db, {
    userId: tenantAdminId,
    tenantId: TENANT_ID,
    roles: ["TenantAdmin"],
  });
  ({ id: hrAdminId } = await seedUser(stack.db, {
    email: "hraudit@example.com",
    displayName: "HRAudit",
    passwordHash: await hashPassword("pw-audit-1234"),
    emailVerified: true,
  }));
  await seedTenantMembership(stack.db, {
    userId: hrAdminId,
    tenantId: TENANT_ID,
    roles: ["TenantAdmin", "HR"],
  });
});

describe("access matrix: audit list uses access.admin", () => {
  test("handler and screen share access.admin", () => {
    const adminRoles = [...access.admin];
    expect(rolesOf(stack.registry.getQueryHandler(AuditQueries.list)?.access)).toEqual(adminRoles);
    const audit = createAuditFeature();
    const screen = audit.screens[AUDIT_LOG_SCREEN_ID];
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(adminRoles);
    }
  });
});

describe("TenantAdmin can query audit log for own tenant", () => {
  test("TenantAdmin lists events after write in tenant", async () => {
    await stack.http.writeOk(
      "audit-sec-widgets:write:widget:create",
      { name: "audited" },
      tenantAdmin(),
    );
    const res = await stack.http.queryOk<{ rows: readonly { type: string }[] }>(
      AuditQueries.list,
      {},
      tenantAdmin(),
    );
    expect(res.rows.some((r) => r.type === "widget.created")).toBe(true);
  });
});

describe("regular User denied audit log", () => {
  test("403 on audit:query:list", async () => {
    const res = await stack.http.query(AuditQueries.list, {}, regularUser());
    expect(res.status).toBe(403);
  });
});

describe("systemAdmin retains audit access", () => {
  test("SystemAdmin can list", async () => {
    await stack.http.writeOk("audit-sec-widgets:write:widget:create", { name: "sys" }, systemAdmin);
    const res = await stack.http.queryOk<{ rows: readonly unknown[] }>(
      AuditQueries.list,
      {},
      systemAdmin,
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("tenant isolation", () => {
  test("TenantAdmin does not see events from another tenant", async () => {
    const otherTenant = testTenantId(2);
    await seedTenant(stack.db, { id: otherTenant, key: "audit-other", name: "Other" });
    await seedTenantMembership(stack.db, {
      userId: tenantAdminId,
      tenantId: otherTenant,
      roles: ["TenantAdmin"],
    });
    await stack.http.writeOk(
      "audit-sec-widgets:write:widget:create",
      { name: "other-tenant" },
      { id: tenantAdminId, tenantId: otherTenant, roles: ["TenantAdmin"] },
    );

    const ownTenantRes = await stack.http.queryOk<{ rows: readonly { type: string }[] }>(
      AuditQueries.list,
      {},
      tenantAdmin(),
    );
    expect(ownTenantRes.rows.some((r) => r.type === "widget.created")).toBe(false);
  });
});

describe("audit list filters", () => {
  test("rejects from after to", async () => {
    const res = await stack.http.query(
      AuditQueries.list,
      { from: "2026-01-02T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" },
      tenantAdmin(),
    );
    expect([400, 422]).toContain(res.status);
  });

  test("filters by eventType within tenant", async () => {
    await stack.http.writeOk(
      "audit-sec-widgets:write:widget:create",
      { name: "filter-me" },
      tenantAdmin(),
    );
    const res = await stack.http.queryOk<{ rows: readonly { type: string }[] }>(
      AuditQueries.list,
      { eventType: "widget.created" },
      tenantAdmin(),
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(1);
    expect(res.rows.every((r) => r.type === "widget.created")).toBe(true);
  });
});

describe("audit payload follows entity read rules", () => {
  type PayloadRow = {
    id: string;
    type: string;
    aggregateId: string;
    payload: Record<string, unknown> | null;
  };
  type PayloadList = { rows: readonly PayloadRow[] };

  async function listFor(aggregateType: string, user: SessionUser): Promise<PayloadList> {
    return stack.http.queryOk<PayloadList>(AuditQueries.list, { aggregateType }, user);
  }

  function rowOfType(list: PayloadList, type: string): PayloadRow {
    const row = list.rows.find((r) => r.type === type);
    if (!row) throw new Error(`no ${type} row in the audit list`);
    return row;
  }

  test("a payload of an entity the caller may not read is null in list and details", async () => {
    await stack.http.writeOk(
      "audit-sec-restricted:write:dossier:create",
      { name: "Confidential" },
      hrTenantAdmin(),
    );

    const forTenantAdmin = rowOfType(await listFor("dossier", tenantAdmin()), "dossier.created");
    expect(forTenantAdmin.payload).toBeNull();
    const detailsForTenantAdmin = await stack.http.queryOk<PayloadRow>(
      AuditQueries.details,
      { id: forTenantAdmin.id },
      tenantAdmin(),
    );
    expect(detailsForTenantAdmin.payload).toBeNull();

    const forHr = rowOfType(await listFor("dossier", hrTenantAdmin()), "dossier.created");
    expect(forHr.payload).toMatchObject({ name: "Confidential" });
  });

  test("restricted fields are removed from the snapshot, changes and previous", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "audit-sec-restricted:write:memo:create",
      { name: "Memo", salary: "100000", pin: "1234" },
      hrTenantAdmin(),
    );
    await stack.http.writeOk(
      "audit-sec-restricted:write:memo:update",
      { id: created.id, version: 1, changes: { salary: "120000" } },
      hrTenantAdmin(),
    );

    const forTenantAdmin = await listFor("memo", tenantAdmin());
    const createdPayload = rowOfType(forTenantAdmin, "memo.created").payload;
    expect(createdPayload).toMatchObject({ name: "Memo" });
    expect(createdPayload).not.toHaveProperty("salary");
    expect(createdPayload).not.toHaveProperty("pin");
    const updatedPayload = rowOfType(forTenantAdmin, "memo.updated").payload;
    expect(updatedPayload?.["changes"]).not.toHaveProperty("salary");
    expect(updatedPayload?.["previous"]).not.toHaveProperty("salary");

    const forHr = await listFor("memo", hrTenantAdmin());
    const hrCreatedPayload = rowOfType(forHr, "memo.created").payload;
    expect(hrCreatedPayload).toMatchObject({ name: "Memo", salary: "100000" });
    expect(hrCreatedPayload).not.toHaveProperty("pin");
  });

  test("embedded fields with a restricted sub-field are removed", async () => {
    await stack.http.writeOk(
      "audit-sec-restricted:write:memo:create",
      { name: "Memo", bonus: { amount: "5000" }, reviews: [{ note: "good" }] },
      hrTenantAdmin(),
    );

    const forTenantAdmin = rowOfType(await listFor("memo", tenantAdmin()), "memo.created").payload;
    expect(forTenantAdmin).toMatchObject({ name: "Memo" });
    expect(forTenantAdmin).not.toHaveProperty("bonus");
    expect(forTenantAdmin).not.toHaveProperty("reviews");

    const forHr = rowOfType(await listFor("memo", hrTenantAdmin()), "memo.created").payload;
    expect(forHr).toMatchObject({ bonus: { amount: "5000" }, reviews: [{ note: "good" }] });
  });

  test("a declared verb event is stripped like updated instead of withheld", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "audit-sec-restricted:write:memo:create",
      { name: "Memo", salary: "100000" },
      hrTenantAdmin(),
    );
    await stack.http.writeOk(
      "audit-sec-restricted:write:memo:review",
      { id: created.id, salary: "130000" },
      hrTenantAdmin(),
    );

    const reviewedPayload = rowOfType(
      await listFor("memo", tenantAdmin()),
      "memo.reviewed",
    ).payload;
    expect(reviewedPayload).not.toBeNull();
    expect(reviewedPayload?.["changes"]).not.toHaveProperty("salary");
    expect(reviewedPayload?.["previous"]).not.toHaveProperty("salary");
  });
});

describe("system scope", () => {
  type EventRow = { id: string; type: string; aggregateId: string };
  let systemAggregateId: string;

  beforeEach(async () => {
    systemAggregateId = generateId();
    await append(stack.db, {
      aggregateId: systemAggregateId,
      aggregateType: APP_INSTANCE_STREAM_TYPE,
      tenantId: SYSTEM_TENANT_ID,
      expectedVersion: 0,
      type: APP_STARTED_EVENT_TYPE,
      payload: { version: "1.0.0", instanceId: "test", startedAt: "2026-01-01T00:00:00Z" },
      metadata: { userId: SYSTEM_USER_ID },
    });
  });

  async function systemEventId(): Promise<string> {
    const res = await stack.http.queryOk<{ rows: readonly EventRow[] }>(
      AuditQueries.list,
      { scope: AuditScopes.system },
      systemAdmin,
    );
    const row = res.rows.find((r) => r.aggregateId === systemAggregateId);
    if (!row) throw new Error("system event missing");
    return row.id;
  }

  test("SystemAdmin lists and reads the system event with scope system", async () => {
    const res = await stack.http.queryOk<{ rows: readonly EventRow[] }>(
      AuditQueries.list,
      { scope: AuditScopes.system },
      systemAdmin,
    );
    expect(res.rows.map((r) => [r.type, r.aggregateId])).toEqual([
      [APP_STARTED_EVENT_TYPE, systemAggregateId],
    ]);

    const details = await stack.http.queryOk<EventRow | null>(
      AuditQueries.details,
      { id: res.rows[0]?.id, scope: AuditScopes.system },
      systemAdmin,
    );
    expect(details?.type).toBe(APP_STARTED_EVENT_TYPE);
    expect(details?.aggregateId).toBe(systemAggregateId);
  });

  test("SystemAdmin without scope does not see the system event", async () => {
    const id = await systemEventId();
    const res = await stack.http.queryOk<{ rows: readonly EventRow[] }>(
      AuditQueries.list,
      {},
      systemAdmin,
    );
    expect(res.rows.some((r) => r.aggregateId === systemAggregateId)).toBe(false);
    const details = await stack.http.queryOk<EventRow | null>(
      AuditQueries.details,
      { id },
      systemAdmin,
    );
    expect(details).toBeNull();
  });

  test("TenantAdmin is denied scope system on list and details", async () => {
    const id = await systemEventId();
    const list = await stack.http.query(
      AuditQueries.list,
      { scope: AuditScopes.system },
      tenantAdmin(),
    );
    expect(list.status).toBe(403);
    const details = await stack.http.query(
      AuditQueries.details,
      { id, scope: AuditScopes.system },
      tenantAdmin(),
    );
    expect(details.status).toBe(403);
  });

  test("scope system exposes only app-instance streams, not other system-tenant streams", async () => {
    const foreignAggregateId = generateId();
    await append(stack.db, {
      aggregateId: foreignAggregateId,
      aggregateType: "session-revocation",
      tenantId: SYSTEM_TENANT_ID,
      expectedVersion: 0,
      type: APP_STARTED_EVENT_TYPE,
      payload: { version: "0", instanceId: "foreign-stream", startedAt: "2026-01-01T00:00:00Z" },
      metadata: { userId: SYSTEM_USER_ID },
    });
    const listed = await stack.http.queryOk<{ rows: readonly EventRow[] }>(
      AuditQueries.list,
      { scope: AuditScopes.system, aggregateType: "session-revocation" },
      systemAdmin,
    );
    expect(listed.rows.some((r) => r.aggregateId === foreignAggregateId)).toBe(false);

    const all = await stack.http.queryOk<{ rows: readonly EventRow[] }>(
      AuditQueries.list,
      { scope: AuditScopes.system },
      systemAdmin,
    );
    expect(all.rows.map((r) => r.aggregateId)).toEqual([systemAggregateId]);

    const [foreign] = await selectMany<{ id: bigint }>(stack.db, eventsTable, {
      aggregateId: foreignAggregateId,
    });
    const details = await stack.http.queryOk<EventRow | null>(
      AuditQueries.details,
      { id: String(foreign?.id), scope: AuditScopes.system },
      systemAdmin,
    );
    expect(details).toBeNull();
  });

  test("Admin without scope sees only the own tenant", async () => {
    const res = await stack.http.queryOk<{ rows: readonly EventRow[] }>(
      AuditQueries.list,
      {},
      createTestUser({ id: 43, tenantId: TENANT_ID, roles: ["Admin"] }),
    );
    expect(res.rows.some((r) => r.aggregateId === systemAggregateId)).toBe(false);
  });
});
