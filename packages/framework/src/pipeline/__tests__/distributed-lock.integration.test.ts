import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { createTestRedis, type TestRedis } from "@cosmicdrift/kumiko-testing/stack";
import { createDistributedLock } from "../distributed-lock.ts";
import { RedisKeys } from "../redis-keys.ts";

let testRedis: TestRedis;

// 1s TTLs below: 60 × 50ms bounds the wait at 3s instead of a fixed sleep.
const ONE_SECOND_TTL_POLL_DELAYS_MS = Array.from({ length: 60 }, () => 50);

function lockPttlMs(key: string): Promise<number> {
  return testRedis.redis.pttl(`${RedisKeys.lock}${key}`);
}

beforeAll(async () => {
  testRedis = await createTestRedis();
});

afterAll(async () => {
  await testRedis.cleanup();
});

describe("distributed lock", () => {
  test("acquire returns token on success", async () => {
    const lock = createDistributedLock(testRedis.redis);
    const token = await lock.acquire("test-lock-1");
    expect(typeof token).toBe("string");
  });

  test("second acquire on same key fails", async () => {
    const lock = createDistributedLock(testRedis.redis);
    const token1 = await lock.acquire("test-lock-2");
    const token2 = await lock.acquire("test-lock-2");

    expect(typeof token1).toBe("string");
    expect(token2).toBeNull();
  });

  test("release allows re-acquire", async () => {
    const lock = createDistributedLock(testRedis.redis);
    const token = await lock.acquire("test-lock-3");
    expect(typeof token).toBe("string");

    if (!token) throw new Error("expected token");
    const released = await lock.release("test-lock-3", token);
    expect(released).toBe(true);

    const token2 = await lock.acquire("test-lock-3");
    expect(typeof token2).toBe("string");
  });

  test("release with wrong token fails", async () => {
    const lock = createDistributedLock(testRedis.redis);
    await lock.acquire("test-lock-4");

    const released = await lock.release("test-lock-4", "wrong-token");
    expect(released).toBe(false);
  });

  test("lock expires after TTL", async () => {
    const lock = createDistributedLock(testRedis.redis);
    await lock.acquire("test-lock-5", { ttlSeconds: 1 });

    // Can't acquire immediately
    expect(await lock.acquire("test-lock-5")).toBeNull();

    const pttlMs = await lockPttlMs("test-lock-5");
    expect(pttlMs).toBeGreaterThan(0);
    expect(pttlMs).toBeLessThanOrEqual(1000);

    await waitFor(
      async () => {
        expect(typeof (await lock.acquire("test-lock-5"))).toBe("string");
      },
      { delays: ONE_SECOND_TTL_POLL_DELAYS_MS },
    );
  });

  test("renew extends the TTL for the owning token", async () => {
    const lock = createDistributedLock(testRedis.redis);
    const token = await lock.acquire("test-lock-6", { ttlSeconds: 1 });
    if (!token) throw new Error("expected token");

    const renewed = await lock.renew("test-lock-6", token, 5);
    expect(renewed).toBe(true);

    // EXPIRE 5 resets the PTTL to 5000ms, far above the original 1s.
    const pttlMs = await lockPttlMs("test-lock-6");
    expect(pttlMs).toBeGreaterThan(4000);
    expect(pttlMs).toBeLessThanOrEqual(5000);
    expect(await lock.acquire("test-lock-6")).toBeNull();
  });

  test("renew with wrong token fails and does not extend the TTL", async () => {
    const lock = createDistributedLock(testRedis.redis);
    await lock.acquire("test-lock-7", { ttlSeconds: 1 });

    const renewed = await lock.renew("test-lock-7", "wrong-token", 5);
    expect(renewed).toBe(false);

    // The key still exists with its original 1s TTL: the wrong-token renew didn't touch it.
    const pttlMs = await lockPttlMs("test-lock-7");
    expect(pttlMs).toBeGreaterThan(0);
    expect(pttlMs).toBeLessThanOrEqual(1000);
  });

  test("renew with ttlSeconds 0 does not drop the lock", async () => {
    const lock = createDistributedLock(testRedis.redis);
    const token = await lock.acquire("test-lock-ttl0", { ttlSeconds: 5 });
    if (!token) throw new Error("expected token");
    const renewed = await lock.renew("test-lock-ttl0", token, 0);
    expect(renewed).toBe(false);
    // Original lock still held — a peer acquire must fail.
    const peer = await lock.acquire("test-lock-ttl0", { ttlSeconds: 5 });
    expect(peer).toBeNull();
    await lock.release("test-lock-ttl0", token);
  });

  test("renew on an expired/absent key fails", async () => {
    const lock = createDistributedLock(testRedis.redis);
    const renewed = await lock.renew("test-lock-8-never-acquired", "some-token", 5);
    expect(renewed).toBe(false);
  });
});
