// The real kumiko_events table must be accepted by the typed read helpers
// (selectMany with jsonText, aggregateWhere with orderByKeys). Events are
// seeded through the event store's own appendRaw, never by direct INSERT.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { TenantId } from "../../engine/types/index.js";
import { appendRaw } from "../../event-store/admin-api.js";
import { eventsTable } from "../../event-store/events-schema.js";
import { createTestDb, type TestDb } from "../../stack/index.js";
import { generateId } from "../../utils/index.js";
import { aggregateWhere, asRawClient, selectMany } from "../query.js";

let testDb: TestDb;
const tenantId = generateId() as TenantId;
const otherTenantId = generateId() as TenantId;

beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  await asRawClient(testDb.db).unsafe("TRUNCATE kumiko_events RESTART IDENTITY");
});

async function seed(
  tenant: TenantId,
  day: string,
  payload: Record<string, unknown>,
  type = "ai.call.completed",
): Promise<void> {
  await appendRaw(testDb.db, {
    aggregateId: generateId(),
    aggregateType: "ai-call",
    tenantId: tenant,
    expectedVersion: 0,
    type,
    payload,
    metadata: { userId: "seed-user", requestId: "seed" },
    createdAt: Temporal.Instant.from(`2026-03-${day}T12:00:00Z`),
    createdBy: "seed-user",
  });
}

describe("eventsTable with raw-sql helpers", () => {
  test("selectMany filters on tenant, type, createdAt range and jsonText payload", async () => {
    await seed(tenantId, "01", { handlerName: "h1", respondedModel: "m1" });
    await seed(tenantId, "02", { handlerName: "h1", requestedModel: "m1" });
    await seed(tenantId, "03", { handlerName: "h1", respondedModel: "m2" });
    await seed(tenantId, "04", { handlerName: "h2", respondedModel: "m1" });
    await seed(tenantId, "05", { handlerName: "h1", respondedModel: "m1" }, "ai.call.failed");
    await seed(otherTenantId, "02", { handlerName: "h1", respondedModel: "m1" });
    await seed(tenantId, "20", { handlerName: "h1", respondedModel: "m1" });

    const rows = await selectMany<{ createdAt: Temporal.Instant; tenantId: string }>(
      testDb.db,
      eventsTable,
      {
        tenantId,
        aggregateType: "ai-call",
        type: "ai.call.completed",
        createdAt: {
          gte: Temporal.Instant.from("2026-03-01T00:00:00Z"),
          lte: Temporal.Instant.from("2026-03-10T00:00:00Z"),
        },
        payload: {
          jsonText: [
            { keys: ["handlerName"], eq: "h1" },
            { keys: ["respondedModel", "requestedModel"], eq: "m1" },
          ],
        },
      },
      { orderBy: { col: "createdAt" }, limit: 10 },
    );
    expect(rows.map((r) => r.createdAt.toString())).toEqual([
      "2026-03-01T12:00:00Z",
      "2026-03-02T12:00:00Z",
    ]);
    expect(rows.every((r) => r.tenantId === tenantId)).toBe(true);
  });

  test("aggregateWhere groups by createdAt descending with a cap", async () => {
    for (const day of ["01", "02", "03", "04"]) await seed(tenantId, day, { handlerName: "h" });
    await seed(otherTenantId, "09", { handlerName: "h" });
    const rows = await aggregateWhere(
      testDb.db,
      eventsTable,
      {
        measure: { fn: "count" },
        groupBy: [{ field: "createdAt" }],
        orderByKeys: "desc",
        limit: 2,
      },
      { tenantId, aggregateType: "ai-call" },
    );
    expect(rows.map((r) => Date.parse(String(r.keys[0])))).toEqual([
      Date.parse("2026-03-04T12:00:00Z"),
      Date.parse("2026-03-03T12:00:00Z"),
    ]);
    expect(rows.every((r) => r.value === 1)).toBe(true);
  });
});
