import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createTestDb, type TestDb } from "../../testing";
import {
  append,
  createEventsTable,
  findEventByRequestId,
  IdempotencyReplayError,
  loadAggregate,
  loadAggregateAsOf,
  loadEventsAfterVersion,
  VersionConflictError,
} from "../index";

let testDb: TestDb;

const tenantA = uuid();
const tenantB = uuid();
const userA = uuid();

beforeAll(async () => {
  testDb = await createTestDb();
  await createEventsTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await testDb.db.execute(sql`TRUNCATE events RESTART IDENTITY`);
});

describe("event-store: append + load", () => {
  test("append first event writes version=1 and round-trips via loadAggregate", async () => {
    const aggregateId = uuid();

    const stored = await append(testDb.db, {
      aggregateId,
      aggregateType: "task",
      tenantId: tenantA,
      expectedVersion: 0,
      type: "task.created",
      payload: { title: "Buy milk" },
      metadata: { userId: userA },
    });

    expect(stored.version).toBe(1);
    expect(stored.id).toBeDefined();

    const events = await loadAggregate(testDb.db, aggregateId, tenantA);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("task.created");
    expect(events[0]?.payload).toEqual({ title: "Buy milk" });
    expect(events[0]?.metadata.userId).toBe(userA);
  });

  test("subsequent appends increment version and are ordered", async () => {
    const aggregateId = uuid();
    const base = {
      aggregateId,
      aggregateType: "task",
      tenantId: tenantA,
      metadata: { userId: userA },
    };

    await append(testDb.db, {
      ...base,
      expectedVersion: 0,
      type: "task.created",
      payload: { title: "T" },
    });
    await append(testDb.db, {
      ...base,
      expectedVersion: 1,
      type: "task.updated",
      payload: { title: "T2" },
    });
    await append(testDb.db, {
      ...base,
      expectedVersion: 2,
      type: "task.completed",
      payload: {},
    });

    const events = await loadAggregate(testDb.db, aggregateId, tenantA);
    expect(events.map((e) => e.version)).toEqual([1, 2, 3]);
    expect(events.map((e) => e.type)).toEqual(["task.created", "task.updated", "task.completed"]);
  });
});

describe("event-store: optimistic concurrency", () => {
  test("wrong expectedVersion throws VersionConflictError (no write)", async () => {
    const aggregateId = uuid();
    await append(testDb.db, {
      aggregateId,
      aggregateType: "task",
      tenantId: tenantA,
      expectedVersion: 0,
      type: "task.created",
      payload: { title: "Orig" },
      metadata: { userId: userA },
    });

    // Stale writer: thinks predecessor is at v0 — but v1 already exists.
    await expect(
      append(testDb.db, {
        aggregateId,
        aggregateType: "task",
        tenantId: tenantA,
        expectedVersion: 0,
        type: "task.updated",
        payload: { title: "Stale" },
        metadata: { userId: userA },
      }),
    ).rejects.toThrow(VersionConflictError);

    const events = await loadAggregate(testDb.db, aggregateId, tenantA);
    expect(events).toHaveLength(1);
  });

  test("concurrent writers at same expectedVersion: exactly one wins", async () => {
    const aggregateId = uuid();
    await append(testDb.db, {
      aggregateId,
      aggregateType: "task",
      tenantId: tenantA,
      expectedVersion: 0,
      type: "task.created",
      payload: { title: "Orig" },
      metadata: { userId: userA },
    });

    const update = (label: string) =>
      append(testDb.db, {
        aggregateId,
        aggregateType: "task",
        tenantId: tenantA,
        expectedVersion: 1,
        type: "task.updated",
        payload: { title: label },
        metadata: { userId: userA },
      });

    const results = await Promise.allSettled([update("A"), update("B")]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(VersionConflictError);

    const events = await loadAggregate(testDb.db, aggregateId, tenantA);
    expect(events).toHaveLength(2);
  });
});

describe("event-store: tenant isolation", () => {
  test("cross-tenant append at same aggregateId is rejected", async () => {
    const aggregateId = uuid();
    await append(testDb.db, {
      aggregateId,
      aggregateType: "task",
      tenantId: tenantA,
      expectedVersion: 0,
      type: "task.created",
      payload: {},
      metadata: { userId: userA },
    });

    // Tenant B tries to write v2 against A's v1 — predecessor check must fail.
    await expect(
      append(testDb.db, {
        aggregateId,
        aggregateType: "task",
        tenantId: tenantB,
        expectedVersion: 1,
        type: "task.updated",
        payload: {},
        metadata: { userId: userA },
      }),
    ).rejects.toThrow(VersionConflictError);

    const eventsA = await loadAggregate(testDb.db, aggregateId, tenantA);
    const eventsB = await loadAggregate(testDb.db, aggregateId, tenantB);
    expect(eventsA).toHaveLength(1);
    expect(eventsB).toHaveLength(0);
  });
});

describe("event-store: idempotency via requestId", () => {
  test("same (tenant, requestId) twice → IdempotencyReplayError on the second", async () => {
    const aggregateId1 = uuid();
    const aggregateId2 = uuid();
    const requestId = uuid();

    await append(testDb.db, {
      aggregateId: aggregateId1,
      aggregateType: "task",
      tenantId: tenantA,
      expectedVersion: 0,
      type: "task.created",
      payload: { title: "First" },
      metadata: { userId: userA, requestId },
    });

    await expect(
      append(testDb.db, {
        aggregateId: aggregateId2,
        aggregateType: "task",
        tenantId: tenantA,
        expectedVersion: 0,
        type: "task.created",
        payload: { title: "Replay" },
        metadata: { userId: userA, requestId },
      }),
    ).rejects.toThrow(IdempotencyReplayError);

    const replayed = await findEventByRequestId(testDb.db, tenantA, requestId);
    expect(replayed?.aggregateId).toBe(aggregateId1);
    expect(replayed?.payload).toEqual({ title: "First" });
  });
});

describe("event-store: asOf + after-version reads", () => {
  test("loadAggregateAsOf excludes events after the timestamp", async () => {
    const aggregateId = uuid();
    const e1 = await append(testDb.db, {
      aggregateId,
      aggregateType: "task",
      tenantId: tenantA,
      expectedVersion: 0,
      type: "task.created",
      payload: {},
      metadata: { userId: userA },
    });
    // Ensure the second event is strictly after.
    await new Promise((r) => setTimeout(r, 5));
    await append(testDb.db, {
      aggregateId,
      aggregateType: "task",
      tenantId: tenantA,
      expectedVersion: 1,
      type: "task.updated",
      payload: {},
      metadata: { userId: userA },
    });

    const atT1 = await loadAggregateAsOf(testDb.db, aggregateId, tenantA, e1.createdAt);
    expect(atT1).toHaveLength(1);
    expect(atT1[0]?.version).toBe(1);
  });

  test("loadEventsAfterVersion returns only events strictly > given version", async () => {
    const aggregateId = uuid();
    for (let v = 0; v < 3; v++) {
      await append(testDb.db, {
        aggregateId,
        aggregateType: "task",
        tenantId: tenantA,
        expectedVersion: v,
        type: v === 0 ? "task.created" : "task.updated",
        payload: { n: v },
        metadata: { userId: userA },
      });
    }

    const after1 = await loadEventsAfterVersion(testDb.db, aggregateId, tenantA, 1);
    expect(after1.map((e) => e.version)).toEqual([2, 3]);
  });
});
