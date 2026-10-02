import { describe, expect, test } from "bun:test";
import { normalizeEmail, storeSignupToken } from "./signup-token-store.js";

// Asserts on the raw Redis key: a case-sensitivity
// regression in the by-email key wouldn't be caught otherwise: two signups from
// "User@Example.com" and "user@example.com" would silently get separate
// live-token entries instead of the second invalidating the first.
function fakeRedis() {
  const calls: { method: string; args: unknown[] }[] = [];
  const redis = {
    set: async (...args: unknown[]) => {
      calls.push({ method: "set", args });
      return "OK";
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal ioredis stand-in for key-string assertions
  } as any;
  return { redis, calls };
}

describe("storeSignupToken", () => {
  test("builds the by-email key from the normalized (lowercased) email", async () => {
    const { redis, calls } = fakeRedis();
    await storeSignupToken(redis, { email: "User@Example.com", token: "tok-1", ttlSeconds: 60 });
    const subjectKey = calls[1]?.args[0];
    expect(subjectKey).toBe(`signup:by-email:${normalizeEmail("User@Example.com")}`);
    expect(subjectKey).toBe("signup:by-email:user@example.com");
  });
});
