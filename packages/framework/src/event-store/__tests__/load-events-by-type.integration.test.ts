import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../db/__tests__/query/bun-test-db.ts";
import { asRawClient } from "../../db/query.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import { generateId as uuid } from "../../utils/index.ts";
import { archiveStream } from "../archive.ts";
import { append, loadEventsOfAggregatesByType } from "../event-store.ts";

let testDb: BunTestDb;

const tenantA = uuid();
const tenantB = uuid();
const userA = uuid();

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(`TRUNCATE kumiko_events RESTART IDENTITY`);
});

async function appendTypes(
  tenantId: string,
  aggregateId: string,
  types: readonly string[],
): Promise<void> {
  let expectedVersion = 0;
  for (const type of types) {
    await append(testDb.db, {
      aggregateId,
      aggregateType: "lease",
      tenantId,
      expectedVersion,
      type,
      payload: { marker: `${aggregateId}:${type}` },
      metadata: { userId: userA },
    });
    expectedVersion += 1;
  }
}

describe("loadEventsOfAggregatesByType", () => {
  test("returns only requested types of requested aggregates of the own tenant, in version order", async () => {
    const first = uuid();
    const second = uuid();
    const notRequested = uuid();
    await appendTypes(tenantA, first, ["lease.created", "lease.mailed", "lease.terminated"]);
    await appendTypes(tenantA, second, ["lease.created", "lease.revoked", "lease.mailed"]);
    await appendTypes(tenantA, notRequested, ["lease.mailed"]);
    await appendTypes(tenantB, first, ["lease.mailed"]);

    const events = await loadEventsOfAggregatesByType(testDb.db, tenantA, {
      aggregateIds: [first, second],
      eventTypes: ["lease.mailed", "lease.terminated", "lease.revoked"],
    });

    expect(events.map((e) => [e.aggregateId, e.version, e.type])).toEqual([
      [first, 2, "lease.mailed"],
      [first, 3, "lease.terminated"],
      [second, 2, "lease.revoked"],
      [second, 3, "lease.mailed"],
    ]);
    expect(events.every((e) => e.tenantId === tenantA)).toBe(true);
  });

  test("leaves out archived streams unless includeArchived", async () => {
    const active = uuid();
    const archived = uuid();
    await appendTypes(tenantA, active, ["lease.mailed"]);
    await appendTypes(tenantA, archived, ["lease.mailed"]);
    await archiveStream(testDb.db, {
      tenantId: tenantA,
      aggregateId: archived,
      aggregateType: "lease",
      archivedBy: userA,
    });
    const args = { aggregateIds: [active, archived], eventTypes: ["lease.mailed"] };

    const withoutArchived = await loadEventsOfAggregatesByType(testDb.db, tenantA, args);
    const withArchived = await loadEventsOfAggregatesByType(testDb.db, tenantA, {
      ...args,
      includeArchived: true,
    });

    expect(withoutArchived.map((e) => e.aggregateId)).toEqual([active]);
    expect(withArchived.map((e) => e.aggregateId)).toEqual([active, archived]);
  });

  test("empty aggregateIds or eventTypes return no events", async () => {
    const id = uuid();
    await appendTypes(tenantA, id, ["lease.mailed"]);

    expect(
      await loadEventsOfAggregatesByType(testDb.db, tenantA, {
        aggregateIds: [],
        eventTypes: ["lease.mailed"],
      }),
    ).toEqual([]);
    expect(
      await loadEventsOfAggregatesByType(testDb.db, tenantA, {
        aggregateIds: [id],
        eventTypes: [],
      }),
    ).toEqual([]);
  });
});
