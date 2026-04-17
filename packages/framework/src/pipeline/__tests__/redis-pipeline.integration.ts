import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestRedis, type TestRedis } from "../../testing";
import { createEntityCache } from "../entity-cache";
import { createEventDedup } from "../event-dedup";
import { createEventLog } from "../event-log";
import { createIdempotencyGuard } from "../idempotency";

let testRedis: TestRedis;

beforeAll(async () => {
  testRedis = await createTestRedis();
});

afterAll(async () => {
  await testRedis.cleanup();
});

// --- Idempotency ---

describe("idempotency guard", () => {
  test("returns null for new request", async () => {
    const guard = createIdempotencyGuard(testRedis.redis);
    const result = await guard.check("req-new-123");
    expect(result).toBeNull();
  });

  test("returns cached result for duplicate request", async () => {
    const guard = createIdempotencyGuard(testRedis.redis);
    const requestId = "req-dup-456";

    await guard.store(requestId, { isSuccess: true, data: { id: 1 } });
    const cached = await guard.check(requestId);

    expect(cached).not.toBeNull();
    if (!cached) throw new Error("expected cached value");
    expect(JSON.parse(cached)).toEqual({ isSuccess: true, data: { id: 1 } });
  });

  test("expires after TTL", async () => {
    const guard = createIdempotencyGuard(testRedis.redis, { ttlSeconds: 1 });
    const requestId = "req-ttl-789";

    await guard.store(requestId, { done: true });

    // Should exist immediately
    expect(await guard.check(requestId)).not.toBeNull();

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 1100));

    expect(await guard.check(requestId)).toBeNull();
  });

  test("parallel check(): second caller waits for the first's store() instead of racing", async () => {
    const guard = createIdempotencyGuard(testRedis.redis, {
      pendingTtlSeconds: 5,
      pollIntervalMs: 20,
      waitTimeoutMs: 3_000,
    });
    const requestId = "req-race-1";

    // Request #1 starts — claims the in-progress lock.
    const first = await guard.check(requestId);
    expect(first).toBeNull(); // got the lock

    // Request #2 runs concurrently — must block until #1 stores a result.
    const secondPromise = guard.check(requestId);

    // After a tick the second must still be pending: no result yet.
    await new Promise((r) => setTimeout(r, 80));
    // Race the check — if the guard already resolved we have a race bug.
    const quickResult = await Promise.race([
      secondPromise.then((v) => ({ done: true, v })),
      new Promise<{ done: false }>((r) => setTimeout(() => r({ done: false }), 5)),
    ]);
    expect(quickResult.done).toBe(false);

    // Request #1 finishes.
    await guard.store(requestId, { isSuccess: true, data: { id: 99 } });

    // Request #2 should now see the stored result, not null — no duplicate work.
    const second = await secondPromise;
    expect(second).not.toBeNull();
    expect(JSON.parse(second as string)).toEqual({ isSuccess: true, data: { id: 99 } });
  });

  test("crashed handler: pending marker expires, next caller reclaims the lock", async () => {
    const guard = createIdempotencyGuard(testRedis.redis, {
      pendingTtlSeconds: 1, // expire fast
      pollIntervalMs: 50,
      waitTimeoutMs: 3_000,
    });
    const requestId = "req-crashed";

    const first = await guard.check(requestId);
    expect(first).toBeNull(); // we acquired the lock, then "crash" — never call store()

    // After the pending-TTL lapses, a retry should be allowed to take over.
    const second = await guard.check(requestId);
    expect(second).toBeNull(); // reclaimed
  });
});

// --- Event Log ---

describe("event log", () => {
  test("appends and retrieves events", async () => {
    const log = createEventLog(testRedis.redis);

    await log.append({
      type: "user:create",
      payload: { email: "a@b.de" },
      userId: "11111111-0000-4000-8000-000000000001",
      tenantId: "00000000-0000-4000-8000-000000000001",
    });
    await log.append({
      type: "user:update",
      payload: { name: "Marc" },
      userId: "11111111-0000-4000-8000-000000000001",
      tenantId: "00000000-0000-4000-8000-000000000001",
    });

    const recent = await log.recent(10);
    expect(recent.length).toBeGreaterThanOrEqual(2);
    expect(recent[0]?.type).toBe("user:update"); // most recent first
    expect(recent[1]?.type).toBe("user:create");
  });

  test("limits returned entries", async () => {
    const log = createEventLog(testRedis.redis, "kumiko:test:limit-log");

    for (let i = 0; i < 5; i++) {
      await log.append({
        type: `event.${i}`,
        payload: {},
        userId: "11111111-0000-4000-8000-000000000001",
        tenantId: "00000000-0000-4000-8000-000000000001",
      });
    }

    const recent = await log.recent(3);
    expect(recent).toHaveLength(3);
  });
});

// --- Event Dedup ---

describe("event dedup", () => {
  test("first acquire succeeds", async () => {
    const dedup = createEventDedup(testRedis.redis);
    const acquired = await dedup.tryAcquire("evt-first-001");
    expect(acquired).toBe(true);
  });

  test("second acquire for same eventId fails", async () => {
    const dedup = createEventDedup(testRedis.redis);
    const eventId = "evt-dup-002";

    const first = await dedup.tryAcquire(eventId);
    const second = await dedup.tryAcquire(eventId);

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  test("different eventIds are independent", async () => {
    const dedup = createEventDedup(testRedis.redis);

    const a = await dedup.tryAcquire("evt-a-003");
    const b = await dedup.tryAcquire("evt-b-003");

    expect(a).toBe(true);
    expect(b).toBe(true);
  });

  test("expires after TTL, re-acquire succeeds", async () => {
    const dedup = createEventDedup(testRedis.redis, { ttlSeconds: 1 });
    const eventId = "evt-ttl-004";

    expect(await dedup.tryAcquire(eventId)).toBe(true);
    expect(await dedup.tryAcquire(eventId)).toBe(false);

    await new Promise((r) => setTimeout(r, 1100));

    expect(await dedup.tryAcquire(eventId)).toBe(true);
  });

  test("concurrent acquires — only one wins", async () => {
    const dedup = createEventDedup(testRedis.redis);
    const eventId = "evt-race-005";

    const results = await Promise.all([
      dedup.tryAcquire(eventId),
      dedup.tryAcquire(eventId),
      dedup.tryAcquire(eventId),
    ]);

    const winners = results.filter((r) => r === true);
    expect(winners).toHaveLength(1);
  });
});

// --- Entity Cache ---

describe("entity cache", () => {
  test("get returns null on miss", async () => {
    const cache = createEntityCache(testRedis.redis);
    const result = await cache.get("00000000-0000-4000-8000-000000000001", "order", 999);
    expect(result).toBeNull();
  });

  test("set + get returns cached data", async () => {
    const cache = createEntityCache(testRedis.redis);
    await cache.set("00000000-0000-4000-8000-000000000001", "order", 1, {
      id: 1,
      name: "Test Order",
    });
    const result = await cache.get("00000000-0000-4000-8000-000000000001", "order", 1);
    expect(result).toEqual({ id: 1, name: "Test Order" });
  });

  test("del invalidates cached data", async () => {
    const cache = createEntityCache(testRedis.redis);
    await cache.set("00000000-0000-4000-8000-000000000001", "order", 2, {
      id: 2,
      name: "Delete Me",
    });
    await cache.del("00000000-0000-4000-8000-000000000001", "order", 2);
    expect(await cache.get("00000000-0000-4000-8000-000000000001", "order", 2)).toBeNull();
  });

  test("tenant isolation — same entity id, different tenants", async () => {
    const cache = createEntityCache(testRedis.redis);
    await cache.set("00000000-0000-4000-8000-000000000001", "order", 10, {
      id: 10,
      name: "Tenant 1",
    });
    await cache.set("00000000-0000-4000-8000-000000000002", "order", 10, {
      id: 10,
      name: "Tenant 2",
    });

    expect((await cache.get("00000000-0000-4000-8000-000000000001", "order", 10))?.["name"]).toBe(
      "Tenant 1",
    );
    expect((await cache.get("00000000-0000-4000-8000-000000000002", "order", 10))?.["name"]).toBe(
      "Tenant 2",
    );
  });

  test("mget returns hits and skips misses", async () => {
    const cache = createEntityCache(testRedis.redis);
    await cache.set("00000000-0000-4000-8000-000000000001", "user", 1, { id: 1, name: "Alice" });
    await cache.set("00000000-0000-4000-8000-000000000001", "user", 3, { id: 3, name: "Charlie" });
    // id 2 not cached

    const result = await cache.mget("00000000-0000-4000-8000-000000000001", "user", [1, 2, 3]);
    expect(result.size).toBe(2);
    expect(result.get(1)?.["name"]).toBe("Alice");
    expect(result.get(3)?.["name"]).toBe("Charlie");
    expect(result.has(2)).toBe(false);
  });

  test("mset caches multiple entities in one call", async () => {
    const cache = createEntityCache(testRedis.redis);
    await cache.mset("00000000-0000-4000-8000-000000000001", "product", [
      { id: 10, data: { id: 10, name: "Widget" } },
      { id: 11, data: { id: 11, name: "Gadget" } },
      { id: 12, data: { id: 12, name: "Doohickey" } },
    ]);

    const result = await cache.mget(
      "00000000-0000-4000-8000-000000000001",
      "product",
      [10, 11, 12],
    );
    expect(result.size).toBe(3);
    expect(result.get(11)?.["name"]).toBe("Gadget");
  });

  test("mget + mset pattern: load misses, cache them", async () => {
    const cache = createEntityCache(testRedis.redis);

    // Pre-cache 2 of 4
    await cache.set("00000000-0000-4000-8000-000000000001", "item", 1, { id: 1, name: "Cached A" });
    await cache.set("00000000-0000-4000-8000-000000000001", "item", 3, { id: 3, name: "Cached C" });

    // Request all 4
    const requestedIds = [1, 2, 3, 4];
    const hits = await cache.mget("00000000-0000-4000-8000-000000000001", "item", requestedIds);

    // Find misses
    const missIds = requestedIds.filter((id) => !hits.has(id));
    expect(missIds).toEqual([2, 4]);

    // Simulate DB load for misses
    const fromDb = [
      { id: 2, name: "From DB B" },
      { id: 4, name: "From DB D" },
    ];

    // Cache the misses
    await cache.mset(
      "00000000-0000-4000-8000-000000000001",
      "item",
      fromDb.map((row) => ({ id: row.id, data: row })),
    );

    // Now all 4 are cached
    const allCached = await cache.mget(
      "00000000-0000-4000-8000-000000000001",
      "item",
      requestedIds,
    );
    expect(allCached.size).toBe(4);
    expect(allCached.get(1)?.["name"]).toBe("Cached A");
    expect(allCached.get(2)?.["name"]).toBe("From DB B");
  });

  test("expires after TTL", async () => {
    const cache = createEntityCache(testRedis.redis, { ttlSeconds: 1 });
    await cache.set("00000000-0000-4000-8000-000000000001", "temp", 1, { id: 1 });

    expect(await cache.get("00000000-0000-4000-8000-000000000001", "temp", 1)).not.toBeNull();
    await new Promise((r) => setTimeout(r, 1100));
    expect(await cache.get("00000000-0000-4000-8000-000000000001", "temp", 1)).toBeNull();
  });

  test("Date fields survive the cache round-trip as Date objects", async () => {
    const cache = createEntityCache(testRedis.redis);
    const insertedAt = new Date("2026-04-13T12:34:56.789Z");
    await cache.set("00000000-0000-4000-8000-000000000001", "event", 42, {
      id: 42,
      title: "hi",
      insertedAt,
      note: "not a date: 2026-04",
    });

    const single = await cache.get("00000000-0000-4000-8000-000000000001", "event", 42);
    expect(single?.["insertedAt"]).toBeInstanceOf(Date);
    expect((single?.["insertedAt"] as Date).getTime()).toBe(insertedAt.getTime());
    // Non-ISO strings must not be coerced
    expect(typeof single?.["title"]).toBe("string");
    expect(single?.["note"]).toBe("not a date: 2026-04");

    const batch = await cache.mget("00000000-0000-4000-8000-000000000001", "event", [42]);
    expect(batch.get(42)?.["insertedAt"]).toBeInstanceOf(Date);
  });
});
