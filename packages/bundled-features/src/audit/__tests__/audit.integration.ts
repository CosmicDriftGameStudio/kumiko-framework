// Audit query — filter-by-example coverage over the event-store. The event
// log IS the audit trail; this suite proves the query handler exposes the
// right slices of it (tenant-isolated, filtered, paginated, content-intact).

import {
  createEntity,
  createTextField,
  defineEntityWriteHandler,
  defineFeature,
  type SessionUser,
} from "@kumiko/framework/engine";
import {
  createEntityTable,
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
} from "@kumiko/framework/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { AuditQueries } from "../constants";
import { createAuditFeature } from "../feature";

const widgetEntity = createEntity({
  table: "audit_widgets",
  fields: {
    name: createTextField({ required: true }),
    color: createTextField(),
  },
});

const widgetFeature = defineFeature("widgets", (r) => {
  r.entity("widget", widgetEntity);
  for (const verb of ["create", "update", "delete"] as const) {
    r.writeHandler(
      defineEntityWriteHandler(`widget:${verb}`, widgetEntity, {
        access: { roles: ["Admin", "User", "SystemAdmin"] },
      }),
    );
  }
});

let stack: TestStack;

const admin = TestUsers.systemAdmin;
const regularUser: SessionUser = createTestUser({
  id: 7,
  tenantId: testTenantId(1),
  roles: ["User"],
});
const otherTenantAdmin: SessionUser = createTestUser({
  id: 8,
  tenantId: testTenantId(2),
  roles: ["Admin"],
});

beforeAll(async () => {
  stack = await setupTestStack({
    features: [widgetFeature, createAuditFeature()],
  });
  await createEntityTable(stack.db, widgetEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  // Fresh event log per test — the audit query reads the events table
  // directly, so stale events from previous tests would leak into results.
  await resetEventStore(stack);
  await stack.db.execute(sql`TRUNCATE audit_widgets`);
});

async function createWidget(user: SessionUser, name: string, color?: string): Promise<string> {
  const res = await stack.http.writeOk<{ id: string }>(
    "widgets:write:widget:create",
    { name, ...(color && { color }) },
    user,
  );
  return res.id;
}

type AuditRow = {
  id: string;
  aggregateId: string;
  aggregateType: string;
  type: string;
  createdBy: string;
  createdAt: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

type AuditResponse = { rows: AuditRow[]; nextBefore: string | null };

describe("audit: list query", () => {
  test("returns events of the caller's tenant, newest first", async () => {
    await createWidget(admin, "A");
    await createWidget(admin, "B");
    await createWidget(admin, "C");

    const res = await stack.http.queryOk<AuditResponse>(AuditQueries.list, {}, admin);
    expect(res.rows.length).toBeGreaterThanOrEqual(3);
    const names = res.rows.map((r) => r.type);
    expect(names).toContain("widget.created");
    // Descending by id (bigserial) ⇒ newest first.
    for (let i = 1; i < res.rows.length; i++) {
      const prev = BigInt(res.rows[i - 1]!.id);
      const curr = BigInt(res.rows[i]!.id);
      expect(prev > curr).toBe(true);
    }
  });

  test("tenant isolation: admin on tenant-1 sees NO events from tenant-2", async () => {
    await createWidget(admin, "on-tenant-1");
    await stack.http.writeOk<{ id: string }>(
      "widgets:write:widget:create",
      { name: "on-tenant-2" },
      otherTenantAdmin,
    );

    const res = await stack.http.queryOk<AuditResponse>(AuditQueries.list, {}, admin);
    for (const r of res.rows) {
      // Only admin's rows come back — the cross-tenant event's createdBy
      // would be the other-tenant admin's id.
      expect(r.createdBy).toBe(admin.id);
    }
  });

  test("filter by eventType", async () => {
    const id1 = await createWidget(admin, "X");
    await stack.http.writeOk(
      "widgets:write:widget:update",
      { id: id1, version: 1, changes: { color: "red" } },
      admin,
    );
    await stack.http.writeOk("widgets:write:widget:delete", { id: id1 }, admin);

    const updates = await stack.http.queryOk<AuditResponse>(
      AuditQueries.list,
      { eventType: "widget.updated" },
      admin,
    );
    expect(updates.rows).toHaveLength(1);
    expect(updates.rows[0]?.type).toBe("widget.updated");

    const deletes = await stack.http.queryOk<AuditResponse>(
      AuditQueries.list,
      { eventType: "widget.deleted" },
      admin,
    );
    expect(deletes.rows).toHaveLength(1);
    expect(deletes.rows[0]?.type).toBe("widget.deleted");
  });

  test("filter by aggregateId pins the event chain for one entity", async () => {
    const a = await createWidget(admin, "A");
    const b = await createWidget(admin, "B");
    await stack.http.writeOk(
      "widgets:write:widget:update",
      { id: a, version: 1, changes: { color: "blue" } },
      admin,
    );

    const res = await stack.http.queryOk<AuditResponse>(
      AuditQueries.list,
      { aggregateId: a },
      admin,
    );
    expect(res.rows).toHaveLength(2);
    expect(res.rows.every((r) => r.aggregateId === a)).toBe(true);
    expect(res.rows.some((r) => r.aggregateId === b)).toBe(false);
  });

  test("filter by userId", async () => {
    await createWidget(admin, "by admin");
    await createWidget(regularUser, "by user");

    const res = await stack.http.queryOk<AuditResponse>(
      AuditQueries.list,
      { userId: regularUser.id },
      admin,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.createdBy).toBe(regularUser.id);
  });

  test("filter by from/to date range (inclusive bounds, outside-range rows excluded)", async () => {
    // Events are written with server-now at ms precision. Delays between
    // writes + anchor timestamps give us clean sort-order. The anchors are
    // captured OUTSIDE the write bursts so precision-truncation on the
    // db side (ms) can't blur anchor vs event.
    await createWidget(admin, "before-window");
    await new Promise((r) => setTimeout(r, 50));
    const t1 = Temporal.Now.instant();
    await new Promise((r) => setTimeout(r, 10));
    await createWidget(admin, "in-window-1");
    await createWidget(admin, "in-window-2");
    await new Promise((r) => setTimeout(r, 50));
    const t2 = Temporal.Now.instant();
    await new Promise((r) => setTimeout(r, 10));
    await createWidget(admin, "after-window");

    // Slice strictly to the [t1, t2] window — should return exactly 2 rows.
    const inWindow = await stack.http.queryOk<AuditResponse>(
      AuditQueries.list,
      { from: t1.toString(), to: t2.toString() },
      admin,
    );
    expect(inWindow.rows).toHaveLength(2);
    const names = inWindow.rows.map((r) => (r.payload as { name?: string }).name).sort();
    expect(names).toEqual(["in-window-1", "in-window-2"]);

    // From-only: everything at or after t1 → 3 rows (2 in-window + 1 after).
    const sinceT1 = await stack.http.queryOk<AuditResponse>(
      AuditQueries.list,
      { from: t1.toString() },
      admin,
    );
    expect(sinceT1.rows).toHaveLength(3);

    // To-only: everything at or before t1 → just the before-window row.
    const untilT1 = await stack.http.queryOk<AuditResponse>(
      AuditQueries.list,
      { to: t1.toString() },
      admin,
    );
    expect(untilT1.rows).toHaveLength(1);
    expect((untilT1.rows[0]?.payload as { name?: string }).name).toBe("before-window");
  });

  test("rejects inverted from/to range with validation_error", async () => {
    // from > to would silently return empty — confusing. Schema-level refine
    // turns it into a clean 400 at the gate.
    const res = await stack.http.query(
      AuditQueries.list,
      { from: "2030-01-01T00:00:00Z", to: "2020-01-01T00:00:00Z" },
      admin,
    );
    expect(res.status).toBe(400);
  });

  test("rejects non-numeric cursor with validation_error (no PG crash path)", async () => {
    // Pre-fix the handler interpolated `before` directly as bigint, so
    // "abc" would raise an uncaught invalid_text_representation from PG.
    // The schema regex catches it at the gate.
    const res = await stack.http.query(AuditQueries.list, { before: "not-a-number" }, admin);
    expect(res.status).toBe(400);
  });

  test("pagination: limit + nextBefore cursor walks the log", async () => {
    for (let i = 0; i < 5; i++) {
      await createWidget(admin, `W${i}`);
    }

    const page1 = await stack.http.queryOk<AuditResponse>(AuditQueries.list, { limit: 2 }, admin);
    expect(page1.rows).toHaveLength(2);
    expect(page1.nextBefore).not.toBeNull();

    const page2 = await stack.http.queryOk<AuditResponse>(
      AuditQueries.list,
      { limit: 2, before: page1.nextBefore },
      admin,
    );
    expect(page2.rows).toHaveLength(2);
    const page1Ids = page1.rows.map((r) => r.id);
    const page2Ids = page2.rows.map((r) => r.id);
    for (const id of page2Ids) expect(page1Ids).not.toContain(id);

    const page3 = await stack.http.queryOk<AuditResponse>(
      AuditQueries.list,
      { limit: 2, before: page2.nextBefore },
      admin,
    );
    // 5 events, 2+2+1: final page is partial ⇒ nextBefore null.
    expect(page3.rows).toHaveLength(1);
    expect(page3.nextBefore).toBeNull();
  });

  test("response carries the full event payload + metadata (the audit-relevant detail)", async () => {
    const id = await createWidget(admin, "Auditable", "green");
    await stack.http.writeOk(
      "widgets:write:widget:update",
      { id, version: 1, changes: { color: "yellow" } },
      admin,
    );

    const res = await stack.http.queryOk<AuditResponse>(
      AuditQueries.list,
      { aggregateId: id },
      admin,
    );
    // Two events on this stream: created + updated. Newest first.
    expect(res.rows).toHaveLength(2);
    const [updated, created] = res.rows;

    // created: payload IS the initial entity snapshot.
    expect(created?.type).toBe("widget.created");
    expect(created?.payload).toMatchObject({ name: "Auditable", color: "green" });
    // metadata carries the actor (userId) for the write.
    expect(created?.metadata).toMatchObject({ userId: admin.id });

    // updated: payload is { changes, previous } — both halves matter for audit.
    expect(updated?.type).toBe("widget.updated");
    expect(updated?.payload).toMatchObject({
      changes: { color: "yellow" },
      previous: expect.objectContaining({ color: "green", name: "Auditable" }),
    });
    expect(updated?.metadata).toMatchObject({ userId: admin.id });
  });

  test("access denied for non-admin roles", async () => {
    await createWidget(admin, "A");
    // regularUser has role "User" — the handler requires Admin/SystemAdmin.
    const res = await stack.http.query(AuditQueries.list, {}, regularUser);
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      error?: { code?: string; details?: { reason?: string } };
    };
    // Pin the specific failure class. The framework raises AccessDeniedError
    // with code=access_denied; asserting on `code` beats a status-only check
    // (a 403 could also come from ownership-denied, for example).
    expect(body.error?.code).toBe("access_denied");
  });
});
