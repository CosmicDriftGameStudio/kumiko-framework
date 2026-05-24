import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestRedis, type TestRedis } from "../../stack";
import { createDistributedLock } from "../distributed-lock";

let testRedis: TestRedis;

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
    expect(token).not.toBeNull();
    expect(typeof token).toBe("string");
  });

  test("second acquire on same key fails", async () => {
    const lock = createDistributedLock(testRedis.redis);
    const token1 = await lock.acquire("test-lock-2");
    const token2 = await lock.acquire("test-lock-2");

    expect(token1).not.toBeNull();
    expect(token2).toBeNull();
  });

  test("release allows re-acquire", async () => {
    const lock = createDistributedLock(testRedis.redis);
    const token = await lock.acquire("test-lock-3");
    expect(token).not.toBeNull();

    if (!token) throw new Error("expected token");
    const released = await lock.release("test-lock-3", token);
    expect(released).toBe(true);

    const token2 = await lock.acquire("test-lock-3");
    expect(token2).not.toBeNull();
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

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 1100));

    // Now we can
    const token = await lock.acquire("test-lock-5");
    expect(token).not.toBeNull();
  });
});
