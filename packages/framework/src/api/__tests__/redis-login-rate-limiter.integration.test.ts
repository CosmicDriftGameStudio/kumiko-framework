import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
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

  // Regression for the INCR-then-PEXPIRE race: two separate round-trips left
  // a window for a crash/network blip right after the key is created
  // (count===1) to skip the PEXPIRE call entirely, leaving the key
  // permanently without a TTL. The single-eval fix closes that window by
  // construction (one round-trip, can't be interrupted mid-way). "TTL
  // exists after check()" alone doesn't distinguish old from new — the old
  // two-call code also leaves a TTL set on the non-crashing path — so this
  // pins the actual mechanism instead: exactly one `eval` round-trip, and
  // `incr`/`pexpire` are never called directly (the only path is atomic).
  test("check() goes through a single atomic eval — never incr/pexpire directly", async () => {
    const limiter = createRedisLoginRateLimiter(testRedis.redis, 3, 60_000);
    const key = "1.2.3.4|ttl-race@test.local";

    const evalSpy = spyOn(testRedis.redis, "eval");
    const incrSpy = spyOn(testRedis.redis, "incr");
    const pexpireSpy = spyOn(testRedis.redis, "pexpire");
    try {
      expect(await limiter.check(key)).toBe(true);

      expect(evalSpy).toHaveBeenCalledTimes(1);
      expect(incrSpy).not.toHaveBeenCalled();
      expect(pexpireSpy).not.toHaveBeenCalled();

      const ttlMs = await testRedis.redis.pttl(`kumiko:auth:ratelimit:login:${key}`);
      expect(ttlMs).toBeGreaterThan(0);
    } finally {
      evalSpy.mockRestore();
      incrSpy.mockRestore();
      pexpireSpy.mockRestore();
    }
  });
});
