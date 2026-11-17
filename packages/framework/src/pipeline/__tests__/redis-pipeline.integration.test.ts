import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sleep } from "@cosmicdrift/kumiko-testing/helpers";
import { createTestRedis, type TestRedis } from "@cosmicdrift/kumiko-testing/stack";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import { createEventDedup } from "../event-dedup.ts";
import { createIdempotencyGuard } from "../idempotency.ts";

let testRedis: TestRedis;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testRedis = await createTestRedis();
});

afterAll(async () => {
  await testRedis.cleanup();
});

// --- Idempotency ---

describe("idempotency guard", () => {
  const tenantA = "00000000-0000-4000-8000-00000000000a";
  const userA = "00000000-0000-4000-8000-0000000000a1";

  test("returns acquired for new request", async () => {
    const guard = createIdempotencyGuard(testRedis.redis);
    const result = await guard.check(tenantA, userA, "req-new-123");
    expect(result.status).toBe("acquired");
  });

  test("returns cached result for duplicate request", async () => {
    const guard = createIdempotencyGuard(testRedis.redis);
    const requestId = "req-dup-456";

    const acquired = await guard.check(tenantA, userA, requestId);
    if (acquired.status !== "acquired") throw new Error("expected to acquire the lock");
    await guard.store(tenantA, userA, requestId, acquired.token, {
      isSuccess: true,
      data: { id: 1 },
    });
    const cached = await guard.check(tenantA, userA, requestId);

    expect(cached.status).toBe("cached");
    if (cached.status !== "cached") throw new Error("expected cached value");
    expect(JSON.parse(cached.result)).toEqual({ isSuccess: true, data: { id: 1 } });
  });

  test("expires after TTL", async () => {
    const guard = createIdempotencyGuard(testRedis.redis, { ttlSeconds: 1 });
    const requestId = "req-ttl-789";

    const acquired = await guard.check(tenantA, userA, requestId);
    if (acquired.status !== "acquired") throw new Error("expected to acquire the lock");
    await guard.store(tenantA, userA, requestId, acquired.token, { done: true });

    // Should exist immediately
    expect((await guard.check(tenantA, userA, requestId)).status).toBe("cached");

    // Fixed wait: the 1s TTL bound is the assertion.
    await sleep(1100);
    expect((await guard.check(tenantA, userA, requestId)).status).toBe("acquired");
  });

  test("keepPendingAlive holds the lock past pendingTtl so the owner can still store", async () => {
    const guard = createIdempotencyGuard(testRedis.redis, { pendingTtlSeconds: 1 });
    const requestId = "req-keepalive-1";

    const acquired = await guard.check(tenantA, userA, requestId);
    if (acquired.status !== "acquired") throw new Error("expected to acquire the lock");
    const stop = guard.keepPendingAlive(tenantA, userA, requestId, acquired.token);
    try {
      // Fixed wait: longer than the 1s lock TTL, which would have expired without renewal.
      await sleep(2500);
      await guard.store(tenantA, userA, requestId, acquired.token, { ok: true });
    } finally {
      stop();
    }

    const cached = await guard.check(tenantA, userA, requestId);
    expect(cached.status).toBe("cached");
    if (cached.status !== "cached") throw new Error("expected cached value");
    expect(JSON.parse(cached.result)).toEqual({ ok: true });
  });

  test("after stop the pending lock expires on its TTL", async () => {
    const guard = createIdempotencyGuard(testRedis.redis, { pendingTtlSeconds: 1 });
    const requestId = "req-keepalive-2";

    const acquired = await guard.check(tenantA, userA, requestId);
    if (acquired.status !== "acquired") throw new Error("expected to acquire the lock");
    const stop = guard.keepPendingAlive(tenantA, userA, requestId, acquired.token);
    await sleep(500);
    stop();

    // Fixed wait: the 1s lock TTL bound is the assertion.
    await sleep(1600);
    expect((await guard.check(tenantA, userA, requestId)).status).toBe("acquired");
  });

  test("parallel check(): second caller waits for the first's store() instead of racing", async () => {
    const guard = createIdempotencyGuard(testRedis.redis, {
      pendingTtlSeconds: 5,
      pollIntervalMs: 20,
      waitTimeoutMs: 3_000,
    });
    const requestId = "req-race-1";

    // Request #1 starts — claims the in-progress lock.
    const first = await guard.check(tenantA, userA, requestId);
    expect(first.status).toBe("acquired");
    if (first.status !== "acquired") throw new Error("expected to acquire the lock");

    // Request #2 runs concurrently — must block until #1 stores a result.
    const secondPromise = guard.check(tenantA, userA, requestId);

    // After a tick the second must still be pending: no result yet.
    await sleep(80);
    // Race the check — if the guard already resolved we have a race bug.
    const quickResult = await Promise.race([
      secondPromise.then((v) => ({ done: true, v })),
      new Promise<{ done: false }>((r) => setTimeout(() => r({ done: false }), 5)),
    ]);
    expect(quickResult.done).toBe(false);

    // Request #1 finishes.
    await guard.store(tenantA, userA, requestId, first.token, {
      isSuccess: true,
      data: { id: 99 },
    });

    // Request #2 should now see the stored result, not a fresh acquisition —
    // no duplicate work.
    const second = await secondPromise;
    expect(second.status).toBe("cached");
    if (second.status !== "cached") throw new Error("expected cached value");
    expect(JSON.parse(second.result)).toEqual({ isSuccess: true, data: { id: 99 } });
  });

  test("crashed handler: pending marker expires, next caller reclaims the lock", async () => {
    const guard = createIdempotencyGuard(testRedis.redis, {
      pendingTtlSeconds: 1, // expire fast
      pollIntervalMs: 50,
      waitTimeoutMs: 3_000,
    });
    const requestId = "req-crashed";

    const first = await guard.check(tenantA, userA, requestId);
    expect(first.status).toBe("acquired"); // we acquired the lock, then "crash" — never call store()

    // After the pending-TTL lapses, a retry should be allowed to take over.
    const second = await guard.check(tenantA, userA, requestId);
    expect(second.status).toBe("acquired"); // reclaimed
  });

  test("same requestId from different tenant/user does not hit the same cache entry", async () => {
    const guard = createIdempotencyGuard(testRedis.redis);
    const requestId = "req-shared-across-tenants";
    const tenantB = "00000000-0000-4000-8000-00000000000b";
    const userB = "00000000-0000-4000-8000-0000000000b1";

    // Tenant A / user A owns the request and stores its result.
    const firstCheck = await guard.check(tenantA, userA, requestId);
    expect(firstCheck.status).toBe("acquired");
    if (firstCheck.status !== "acquired") throw new Error("expected to acquire the lock");
    await guard.store(tenantA, userA, requestId, firstCheck.token, {
      isSuccess: true,
      data: { tenant: "A" },
    });

    // Same requestId, different tenant+user: must be treated as a fresh
    // request, not see tenant A's cached/pending state.
    const otherTenantCheck = await guard.check(tenantB, userB, requestId);
    expect(otherTenantCheck.status).toBe("acquired");

    // Different user, same tenant: also isolated.
    const otherUserCheck = await guard.check(tenantA, userB, requestId);
    expect(otherUserCheck.status).toBe("acquired");

    // Tenant A's own result is still retrievable and unaffected.
    const ownResult = await guard.check(tenantA, userA, requestId);
    expect(ownResult.status).toBe("cached");
    if (ownResult.status !== "cached") throw new Error("expected cached value");
    expect(JSON.parse(ownResult.result)).toEqual({ isSuccess: true, data: { tenant: "A" } });
  });

  test("bug 1 — wait shorter than the pending lock no longer forces a duplicate re-run", async () => {
    // Same inverted ratio as the pre-fix defaults (waitTimeoutMs < pendingTtl),
    // scaled to sub-second so the test stays fast. Pre-fix, the internal
    // waitTimeoutMs was trusted as-is: the waiter gives up at 100ms and
    // reports "acquired" even though request #1 is still legitimately
    // running and stores its result 200ms later — the double-execute bug.
    // Post-fix, waitTimeoutMs is clamped to stay above pendingTtl, so the
    // waiter keeps polling and observes the real result instead.
    const guard = createIdempotencyGuard(testRedis.redis, {
      pendingTtlSeconds: 1,
      waitTimeoutMs: 100,
      pollIntervalMs: 20,
    });
    const requestId = "req-bug1-inverted-timeout";

    const first = await guard.check(tenantA, userA, requestId);
    expect(first.status).toBe("acquired");
    if (first.status !== "acquired") throw new Error("expected to acquire the lock");

    // Request #1 is "slow" — stores well after the old 100ms wait window,
    // but well within pendingTtl (1s).
    const storeAfterDelay = (async () => {
      await new Promise((r) => setTimeout(r, 300));
      await guard.store(tenantA, userA, requestId, first.token, {
        isSuccess: true,
        data: { id: "slow-handler" },
      });
    })();

    const second = await guard.check(tenantA, userA, requestId);
    await storeAfterDelay;

    // Must observe request #1's real result — never a second "acquired".
    expect(second.status).toBe("cached");
    if (second.status !== "cached") throw new Error("expected cached value, not a re-run");
    expect(JSON.parse(second.result)).toEqual({ isSuccess: true, data: { id: "slow-handler" } });
  });

  test("bug 2 (window B) — a reclaimed lock's fresh result survives the original owner's stale store()", async () => {
    const guard = createIdempotencyGuard(testRedis.redis, {
      pendingTtlSeconds: 1, // expire fast so we can force a reclaim quickly
      waitTimeoutMs: 6_000,
      pollIntervalMs: 20,
    });
    const requestId = "req-bug2-window-b";

    // Original owner acquires, then "hangs" (never stores) past pendingTtl.
    const original = await guard.check(tenantA, userA, requestId);
    expect(original.status).toBe("acquired");
    if (original.status !== "acquired") throw new Error("expected to acquire the lock");

    // Let the lock expire, then a second run reclaims it and finishes fast.
    await sleep(1100);
    const reclaimer = await guard.check(tenantA, userA, requestId);
    expect(reclaimer.status).toBe("acquired");
    if (reclaimer.status !== "acquired") throw new Error("expected to reclaim the lock");
    await guard.store(tenantA, userA, requestId, reclaimer.token, {
      isSuccess: true,
      data: { owner: "reclaimer" },
    });

    // The original (now-stale) run finally "finishes" and tries to store its
    // own, outdated result using its original token.
    await guard.store(tenantA, userA, requestId, original.token, {
      isSuccess: true,
      data: { owner: "original-stale" },
    });

    // The reclaimer's fresh result must survive — the stale store() must be
    // a no-op, not a silent overwrite.
    const final = await guard.check(tenantA, userA, requestId);
    expect(final.status).toBe("cached");
    if (final.status !== "cached") throw new Error("expected cached value");
    expect(JSON.parse(final.result)).toEqual({ isSuccess: true, data: { owner: "reclaimer" } });
  });

  test("release() frees the lock — a waiting check() reclaims immediately instead of polling out", async () => {
    const guard = createIdempotencyGuard(testRedis.redis, {
      pendingTtlSeconds: 5,
      pollIntervalMs: 20,
      waitTimeoutMs: 10_000,
    });
    const requestId = "req-release-1";

    const first = await guard.check(tenantA, userA, requestId);
    expect(first.status).toBe("acquired");
    if (first.status !== "acquired") throw new Error("expected to acquire the lock");

    // Waiter starts BEFORE release — if release is a no-op this only resolves
    // once waitTimeoutMs elapses (10s), which the 500ms race below catches.
    const waiterPromise = guard.check(tenantA, userA, requestId);

    await guard.release(tenantA, userA, requestId, first.token);

    const raced = await Promise.race([
      waiterPromise.then((v) => ({ done: true as const, v })),
      new Promise<{ done: false }>((r) => setTimeout(() => r({ done: false }), 500)),
    ]);
    expect(raced.done).toBe(true);
    if (!raced.done) throw new Error("waiter did not reclaim after release()");
    expect(raced.v.status).toBe("acquired");
  });

  test("release() with a stale token is a no-op — it must not clear a new owner's lock", async () => {
    const guard = createIdempotencyGuard(testRedis.redis, {
      pendingTtlSeconds: 1,
      pollIntervalMs: 20,
      waitTimeoutMs: 6_000,
    });
    const requestId = "req-release-stale";

    const original = await guard.check(tenantA, userA, requestId);
    expect(original.status).toBe("acquired");
    if (original.status !== "acquired") throw new Error("expected to acquire the lock");

    // Let the lock expire, then a new owner reclaims it.
    await sleep(1100);
    const reclaimer = await guard.check(tenantA, userA, requestId);
    expect(reclaimer.status).toBe("acquired");
    if (reclaimer.status !== "acquired") throw new Error("expected to reclaim the lock");

    // The original (stale) owner's release() must not touch the reclaimer's lock.
    await guard.release(tenantA, userA, requestId, original.token);

    await guard.store(tenantA, userA, requestId, reclaimer.token, {
      isSuccess: true,
      data: { owner: "reclaimer" },
    });

    const final = await guard.check(tenantA, userA, requestId);
    expect(final.status).toBe("cached");
    if (final.status !== "cached") throw new Error("expected cached value");
    expect(JSON.parse(final.result)).toEqual({ isSuccess: true, data: { owner: "reclaimer" } });
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

    // Fixed wait: the 1s TTL bound is the assertion.
    await sleep(1100);
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
