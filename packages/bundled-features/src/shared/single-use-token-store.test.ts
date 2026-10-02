import { describe, expect, test } from "bun:test";
import { createRecordingRedisFake } from "./__tests__/recording-redis-fake.js";
import { createSingleUseTokenStore } from "./single-use-token-store.js";

// Production Redis has active signup/invite tokens under these exact keys —
// asserting the generated Redis key strings (not just behavior through a
// mocked client) catches a prefix typo that would silently make existing
// tokens unreachable.
function fakeRedis(getResult: string | null = null) {
  return createRecordingRedisFake({
    set: "OK",
    get: getResult,
    del: 1,
    mget: [],
    incr: 1,
    expire: 1,
  });
}

const TOKEN = "tok-1";
// Hard-coded on purpose: recomputing it with the implementation would let a
// hashing change (algorithm, encoding, raw token) pass unnoticed.
const TOKEN_SHA256_HEX = "65dcf16ea3dfa49069628089eb4a75483070f5584b2a21ee64912b5f621f12da";

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
    expect(forwardKey).toBe(`signup:by-token:${TOKEN_SHA256_HEX}`);
    expect(calls[0]?.args[1]).toBe("user@example.com");
    expect(subjectKey).toBe("signup:by-email:user@example.com");
    expect(calls[1]?.args[1]).toBe(TOKEN_SHA256_HEX);
  });

  test("burn writes under signup:burn:", async () => {
    const { redis, calls } = fakeRedis();
    await store.burn(redis, TOKEN);
    expect(calls[0]?.args).toEqual([`signup:burn:${TOKEN_SHA256_HEX}`, "1", "EX", 3600, "NX"]);
  });

  test("invalidateExistingBySubject deletes the forward key from the stored hash plus the subject key", async () => {
    const { redis, calls } = fakeRedis(TOKEN_SHA256_HEX);
    await store.invalidateExistingBySubject(redis, "user@example.com");
    expect(calls[0]).toEqual({ method: "get", args: ["signup:by-email:user@example.com"] });
    expect(calls.slice(1).map((c) => c.args)).toEqual([
      [`signup:by-token:${TOKEN_SHA256_HEX}`],
      ["signup:by-email:user@example.com"],
    ]);
  });

  test("deleteBoth removes the hashed forward key and the subject key, never the burn key", async () => {
    const { redis, calls } = fakeRedis();
    await store.deleteBoth(redis, { subjectId: "user@example.com", token: TOKEN });
    expect(calls.map((c) => c.args)).toEqual([
      [`signup:by-token:${TOKEN_SHA256_HEX}`],
      ["signup:by-email:user@example.com"],
    ]);
  });

  test("unburn deletes exactly the burn key", async () => {
    const { redis, calls } = fakeRedis();
    await store.unburn(redis, TOKEN);
    expect(calls).toEqual([{ method: "del", args: [`signup:burn:${TOKEN_SHA256_HEX}`] }]);
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
    expect(forwardKey).toBe(`invite:by-token:${TOKEN_SHA256_HEX}`);
    expect(calls[0]?.args[1]).toBe("inv-1");
    expect(subjectKey).toBe("invite:by-id:inv-1");
    expect(calls[1]?.args[1]).toBe(TOKEN_SHA256_HEX);
  });

  test("burn writes under invite:burn:", async () => {
    const { redis, calls } = fakeRedis();
    await store.burn(redis, TOKEN);
    expect(calls[0]?.args).toEqual([`invite:burn:${TOKEN_SHA256_HEX}`, "1", "EX", 3600, "NX"]);
  });
});
