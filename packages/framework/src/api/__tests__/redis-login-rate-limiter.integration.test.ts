import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestRedis, type TestRedis } from "../../stack";
import { createRedisLoginRateLimiter } from "../auth-routes";

let testRedis: TestRedis;

beforeAll(async () => {
  testRedis = await createTestRedis();
});

afterAll(async () => {
  await testRedis.cleanup();
});

beforeEach(async () => {
  await testRedis.flushNamespace();
});

describe("createRedisLoginRateLimiter", () => {
  test("allows exactly maxAttempts checks, then blocks", async () => {
    const limiter = createRedisLoginRateLimiter(testRedis.redis, 3, 60_000);

    expect(await limiter.check("1.2.3.4|user@test.local")).toBe(true);
    expect(await limiter.check("1.2.3.4|user@test.local")).toBe(true);
    expect(await limiter.check("1.2.3.4|user@test.local")).toBe(true);
    expect(await limiter.check("1.2.3.4|user@test.local")).toBe(false);
  });

  test("reset clears the counter for that key", async () => {
    const limiter = createRedisLoginRateLimiter(testRedis.redis, 1, 60_000);

    expect(await limiter.check("k")).toBe(true);
    expect(await limiter.check("k")).toBe(false);

    await limiter.reset("k");
    expect(await limiter.check("k")).toBe(true);
  });

  test("buckets are independent per key", async () => {
    const limiter = createRedisLoginRateLimiter(testRedis.redis, 1, 60_000);

    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("b")).toBe(true);
    expect(await limiter.check("a")).toBe(false);
    expect(await limiter.check("b")).toBe(false);
  });

  test("namespace keeps two limiter instances from sharing a keyspace", async () => {
    const login = createRedisLoginRateLimiter(testRedis.redis, 1, 60_000, "login");
    const mfa = createRedisLoginRateLimiter(testRedis.redis, 1, 60_000, "mfa-verify");

    expect(await login.check("1.2.3.4")).toBe(true);
    expect(await mfa.check("1.2.3.4")).toBe(true);
  });

  test("counter resets once windowMs elapses", async () => {
    const limiter = createRedisLoginRateLimiter(testRedis.redis, 1, 150);

    expect(await limiter.check("k")).toBe(true);
    expect(await limiter.check("k")).toBe(false);

    await Bun.sleep(200);

    expect(await limiter.check("k")).toBe(true);
  });
});
