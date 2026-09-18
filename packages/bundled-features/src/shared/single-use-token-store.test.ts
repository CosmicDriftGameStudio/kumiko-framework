import { describe, expect, test } from "bun:test";
import { createSingleUseTokenStore } from "./single-use-token-store";

// Production Redis has active signup/invite tokens under these exact keys —
// asserting the generated Redis key strings (not just behavior through a
// mocked client) catches a prefix typo that would silently make existing
// tokens unreachable. Only integration tests exercised this logic before
// (which never assert on the raw key string), so this is new coverage.
function fakeRedis() {
  const calls: { method: string; args: unknown[] }[] = [];
  const redis = {
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

const TOKEN = "tok-1";

describe("signup Redis key strings", () => {
  const store = createSingleUseTokenStore({
    tokenPrefix: "signup:by-token:",
    subjectPrefix: "signup:by-email:",
    burnPrefix: "signup:burn:",
  });

  test("store writes forward key under signup:by-token: and reverse key under signup:by-email:", async () => {
    const { redis, calls } = fakeRedis();
    await store.store(redis, { subjectId: "user@example.com", token: TOKEN, ttlSeconds: 60 });
    const forwardKey = calls[0]?.args[0];
    const subjectKey = calls[1]?.args[0];
    expect(String(forwardKey)).toStartWith("signup:by-token:");
    expect(subjectKey).toBe("signup:by-email:user@example.com");
  });

  test("burn writes under signup:burn:", async () => {
    const { redis, calls } = fakeRedis();
    await store.burn(redis, TOKEN);
    expect(String(calls[0]?.args[0])).toStartWith("signup:burn:");
  });
});

describe("invite Redis key strings", () => {
  const store = createSingleUseTokenStore({
    tokenPrefix: "invite:by-token:",
    subjectPrefix: "invite:by-id:",
    burnPrefix: "invite:burn:",
  });

  test("store writes forward key under invite:by-token: and reverse key under invite:by-id:", async () => {
    const { redis, calls } = fakeRedis();
    await store.store(redis, { subjectId: "inv-1", token: TOKEN, ttlSeconds: 60 });
    const forwardKey = calls[0]?.args[0];
    const subjectKey = calls[1]?.args[0];
    expect(String(forwardKey)).toStartWith("invite:by-token:");
    expect(subjectKey).toBe("invite:by-id:inv-1");
  });

  test("burn writes under invite:burn:", async () => {
    const { redis, calls } = fakeRedis();
    await store.burn(redis, TOKEN);
    expect(String(calls[0]?.args[0])).toStartWith("invite:burn:");
  });
});
