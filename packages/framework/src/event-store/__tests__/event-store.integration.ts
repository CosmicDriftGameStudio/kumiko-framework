import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createTestDb, type TestDb } from "../../testing";
import {
  append,
  createEventsTable,
  loadAggregate,
  loadAggregateAsOf,
  loadAllEventsByType,
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

describe("event-store: requestId is a trace marker (no DB-level uniqueness)", () => {
  test("same (tenant, requestId) twice → both events persist, no collision", async () => {
    // Idempotency is an HTTP-level concern, handled via Redis in
    // pipeline/idempotency.ts before the command executes. The events-table
    // imposes no uniqueness on metadata.requestId — a single request may
    // write N events (CRUD + ctx.appendEvent + saga follow-ups), all
    // carrying the same requestId as a trace marker.
    const aggregateId1 = uuid();
    const aggregateId2 = uuid();
    const requestId = uuid();

    const first = await append(testDb.db, {
      aggregateId: aggregateId1,
      aggregateType: "task",
      tenantId: tenantA,
      expectedVersion: 0,
      type: "task.created",
      payload: { title: "First" },
      metadata: { userId: userA, requestId },
    });
    const second = await append(testDb.db, {
      aggregateId: aggregateId2,
      aggregateType: "task",
      tenantId: tenantA,
      expectedVersion: 0,
      type: "task.created",
      payload: { title: "Second" },
      metadata: { userId: userA, requestId },
    });

    expect(first.metadata.requestId).toBe(requestId);
    expect(second.metadata.requestId).toBe(requestId);
    expect(first.aggregateId).not.toBe(second.aggregateId);
  });

  test("metadata.headers (Marten free key/value) round-trips via append + load", async () => {
    const aggregateId = uuid();
    const headers = {
      abTestBucket: "control",
      sdkVersion: 42,
      betaFeatures: true,
    };

    await append(testDb.db, {
      aggregateId,
      aggregateType: "task",
      tenantId: tenantA,
      expectedVersion: 0,
      type: "task.created",
      payload: { title: "with headers" },
      metadata: { userId: userA, headers },
    });

    // Subsequent event uses the WHERE-EXISTS raw-SQL path — make sure
    // headers survive that route too, not just the typed insertFirstEvent.
    await append(testDb.db, {
      aggregateId,
      aggregateType: "task",
      tenantId: tenantA,
      expectedVersion: 1,
      type: "task.updated",
      payload: { title: "v2" },
      metadata: { userId: userA, headers: { ...headers, sdkVersion: 43 } },
    });

    const events = await loadAggregate(testDb.db, aggregateId, tenantA);
    expect(events).toHaveLength(2);
    expect(events[0]?.metadata.headers).toEqual(headers);
    expect(events[1]?.metadata.headers).toEqual({ ...headers, sdkVersion: 43 });
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

describe("event-store: loadAllEventsByType", () => {
  // Rückgrat der Projection-Rebuild-Replay: alle Events eines aggregateType,
  // cross-tenant, in chronologischer Reihenfolge. Wurde im second-audit als
  // nicht-getestet gemeldet — dieser Test schließt die Lücke.

  test("returns only events of the requested aggregateType", async () => {
    const taskId = uuid();
    const invoiceId = uuid();

    await append(testDb.db, {
      aggregateId: taskId,
      aggregateType: "task",
      tenantId: tenantA,
      expectedVersion: 0,
      type: "task.created",
      payload: { title: "T" },
      metadata: { userId: userA },
    });
    await append(testDb.db, {
      aggregateId: invoiceId,
      aggregateType: "invoice",
      tenantId: tenantA,
      expectedVersion: 0,
      type: "invoice.created",
      payload: { amount: 42 },
      metadata: { userId: userA },
    });

    const taskEvents = await loadAllEventsByType(testDb.db, "task");
    const invoiceEvents = await loadAllEventsByType(testDb.db, "invoice");

    expect(taskEvents).toHaveLength(1);
    expect(taskEvents[0]?.aggregateId).toBe(taskId);
    expect(taskEvents[0]?.type).toBe("task.created");
    expect(invoiceEvents).toHaveLength(1);
    expect(invoiceEvents[0]?.aggregateId).toBe(invoiceId);
  });

  test("spans all tenants — projection rebuild must see every row", async () => {
    // Rebuilds run system-scoped (cross-tenant) because a projection table
    // can hold data from many tenants. Missing this would leak tenant B's
    // absence into tenant A's projection snapshot after a rebuild.
    const aggA = uuid();
    const aggB = uuid();

    await append(testDb.db, {
      aggregateId: aggA,
      aggregateType: "task",
      tenantId: tenantA,
      expectedVersion: 0,
      type: "task.created",
      payload: { owner: "A" },
      metadata: { userId: userA },
    });
    await append(testDb.db, {
      aggregateId: aggB,
      aggregateType: "task",
      tenantId: tenantB,
      expectedVersion: 0,
      type: "task.created",
      payload: { owner: "B" },
      metadata: { userId: userA },
    });

    const all = await loadAllEventsByType(testDb.db, "task");
    expect(all).toHaveLength(2);
    const tenants = new Set(all.map((e) => e.tenantId));
    expect(tenants).toEqual(new Set([tenantA, tenantB]));
  });

  test("ordered by (createdAt, id) for deterministic replay", async () => {
    // Projection-Rebuild wendet Events in der Reihenfolge an, in der sie
    // geschrieben wurden. Die Sortierung ist Teil des Contracts — ohne sie
    // entstehen je nach Replay unterschiedliche Projection-States.
    const a1 = uuid();
    const a2 = uuid();
    const a3 = uuid();

    const e1 = await append(testDb.db, {
      aggregateId: a1,
      aggregateType: "task",
      tenantId: tenantA,
      expectedVersion: 0,
      type: "task.created",
      payload: { n: 1 },
      metadata: { userId: userA },
    });
    await new Promise((r) => setTimeout(r, 5));
    const e2 = await append(testDb.db, {
      aggregateId: a2,
      aggregateType: "task",
      tenantId: tenantA,
      expectedVersion: 0,
      type: "task.created",
      payload: { n: 2 },
      metadata: { userId: userA },
    });
    await new Promise((r) => setTimeout(r, 5));
    const e3 = await append(testDb.db, {
      aggregateId: a3,
      aggregateType: "task",
      tenantId: tenantB,
      expectedVersion: 0,
      type: "task.created",
      payload: { n: 3 },
      metadata: { userId: userA },
    });

    const all = await loadAllEventsByType(testDb.db, "task");
    expect(all.map((e) => e.id)).toEqual([e1.id, e2.id, e3.id]);
    // createdAt strictly non-decreasing
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1];
      const cur = all[i];
      if (!prev || !cur) throw new Error("unreachable");
      expect(Temporal.Instant.compare(prev.createdAt, cur.createdAt)).toBeLessThanOrEqual(0);
    }
  });

  test("returns empty array when no events of that type exist", async () => {
    const events = await loadAllEventsByType(testDb.db, "nonexistent-type");
    expect(events).toEqual([]);
  });

  test("includes every event of an aggregate — multiple versions in order", async () => {
    // A single aggregate with multiple versions must appear in order in the
    // replay stream, otherwise projection-apply sees events out-of-sequence.
    const aggregateId = uuid();
    for (let v = 0; v < 4; v++) {
      await append(testDb.db, {
        aggregateId,
        aggregateType: "task",
        tenantId: tenantA,
        expectedVersion: v,
        type: v === 0 ? "task.created" : "task.updated",
        payload: { v },
        metadata: { userId: userA },
      });
    }

    const all = await loadAllEventsByType(testDb.db, "task");
    expect(all).toHaveLength(4);
    expect(all.map((e) => e.version)).toEqual([1, 2, 3, 4]);
    expect(all.map((e) => (e.payload as { v: number }).v)).toEqual([0, 1, 2, 3]);
  });
});
