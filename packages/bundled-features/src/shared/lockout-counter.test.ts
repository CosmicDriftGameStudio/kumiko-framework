import { describe, expect, test } from "bun:test";
import { createLockoutCounter } from "./lockout-counter.js";

// Production Redis has active lockout/mfa-verify entries under these exact
// keys — only asserting the generated Redis key strings (not just behavior
// through a mocked client) catches a prefix typo that would silently make
// existing entries unreachable. The two prefix pairs below are byte-copies
// of the ones lockout-store.ts and mfa-verify-attempts.ts wire onto this
// factory; only integration tests exercised this logic before (which never
// assert on the raw key string), so this is new coverage.
// countKey/untilKey are not exported by the factory (only the bound
// operations are) — verify the key shape indirectly through a fake Redis
// client that records the keys it's called with.
function fakeRedis(incrResult = 1) {
  const calls: { method: string; args: unknown[] }[] = [];
  const redis = {
    mget: async (...args: unknown[]) => {
      calls.push({ method: "mget", args });
      return [null, null];
    },
    incr: async (...args: unknown[]) => {
      calls.push({ method: "incr", args });
      return incrResult;
    },
    expire: async (...args: unknown[]) => {
      calls.push({ method: "expire", args });
      return 1;
    },
    set: async (...args: unknown[]) => {
      calls.push({ method: "set", args });
      return "OK";
    },
    get: async (...args: unknown[]) => {
      calls.push({ method: "get", args });
      return null;
    },
    del: async (...args: unknown[]) => {
      calls.push({ method: "del", args });
      return 1;
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal ioredis stand-in for key-string assertions
  } as any;
  return { redis, calls };
}

describe("account-lockout Redis key strings", () => {
  const counter = createLockoutCounter("kumiko:auth:lockout:count:", "kumiko:auth:lockout:until:");

  test("getState reads the byte-identical count/until keys", async () => {
    const { redis, calls } = fakeRedis();
    await counter.getState(redis, "u1");
    expect(calls[0]).toEqual({
      method: "mget",
      args: ["kumiko:auth:lockout:count:u1", "kumiko:auth:lockout:until:u1"],
    });
  });

  test("clearState deletes the byte-identical count/until keys", async () => {
    const { redis, calls } = fakeRedis();
    await counter.clearState(redis, "u1");
    expect(calls[0]).toEqual({
      method: "del",
      args: ["kumiko:auth:lockout:count:u1", "kumiko:auth:lockout:until:u1"],
    });
  });

  test("first failure below threshold: INCR then 24h EXPIRE on the count key, no lock", async () => {
    const { redis, calls } = fakeRedis(1);
    const state = await counter.recordFailedAttempt(redis, "u1", 5, 15);
    expect(calls).toEqual([
      { method: "incr", args: ["kumiko:auth:lockout:count:u1"] },
      { method: "expire", args: ["kumiko:auth:lockout:count:u1", 24 * 3600] },
    ]);
    expect(state).toEqual({ failureCount: 1, lockedUntil: null });
  });

  test("crossing the threshold arms the until key with PX <duration> NX", async () => {
    const { redis, calls } = fakeRedis(5);
    const before = Date.now();
    const state = await counter.recordFailedAttempt(redis, "u1", 5, 15);
    const lockMs = 15 * 60 * 1000;
    expect(calls.map((c) => c.method)).toEqual(["incr", "set"]);
    const setArgs = calls[1]?.args ?? [];
    expect(setArgs[0]).toBe("kumiko:auth:lockout:until:u1");
    expect(setArgs.slice(2)).toEqual(["PX", lockMs, "NX"]);
    expect(Number(setArgs[1])).toBeGreaterThanOrEqual(before + lockMs);
    expect(state.failureCount).toBe(5);
    expect(state.lockedUntil).toBe(Number(setArgs[1]));
  });

  test("a lock duration above 24h stretches the count key TTL to the lock duration", async () => {
    const { redis, calls } = fakeRedis(1);
    await counter.recordFailedAttempt(redis, "u1", 5, 48 * 60);
    expect(calls[1]).toEqual({
      method: "expire",
      args: ["kumiko:auth:lockout:count:u1", 48 * 3600],
    });
  });
});

describe("mfa-verify Redis key strings", () => {
  const counter = createLockoutCounter(
    "kumiko:auth:mfa-verify:count:",
    "kumiko:auth:mfa-verify:until:",
  );

  test("getState reads the byte-identical count/until keys", async () => {
    const { redis, calls } = fakeRedis();
    await counter.getState(redis, "u1");
    expect(calls[0]).toEqual({
      method: "mget",
      args: ["kumiko:auth:mfa-verify:count:u1", "kumiko:auth:mfa-verify:until:u1"],
    });
  });

  test("clearState deletes the byte-identical count/until keys", async () => {
    const { redis, calls } = fakeRedis();
    await counter.clearState(redis, "u1");
    expect(calls[0]).toEqual({
      method: "del",
      args: ["kumiko:auth:mfa-verify:count:u1", "kumiko:auth:mfa-verify:until:u1"],
    });
  });
});
