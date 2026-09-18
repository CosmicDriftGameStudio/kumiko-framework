import { describe, expect, test } from "bun:test";
import { createLockoutCounter } from "./lockout-counter";

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
function fakeRedis() {
  const calls: { method: string; args: unknown[] }[] = [];
  const redis = {
    mget: async (...args: unknown[]) => {
      calls.push({ method: "mget", args });
      return [null, null];
    },
    incr: async (...args: unknown[]) => {
      calls.push({ method: "incr", args });
      return 1;
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
