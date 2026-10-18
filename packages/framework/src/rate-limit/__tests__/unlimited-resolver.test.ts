import { describe, expect, test } from "bun:test";
import { createUnlimitedRateLimitResolver } from "../unlimited-resolver.ts";

const config = { limit: 1, windowSeconds: 60, cost: 5 };

describe("createUnlimitedRateLimitResolver", () => {
  test("check and enforce keep allowing the same bucket beyond its limit", async () => {
    const resolver = createUnlimitedRateLimitResolver();
    for (let call = 0; call < 3; call++) {
      expect((await resolver.check("user:1", config)).allowed).toBe(true);
      expect((await resolver.enforce("user:1", config)).allowed).toBe(true);
    }
  });

  test("peek reports a full bucket with nothing to wait for", async () => {
    const decision = await createUnlimitedRateLimitResolver().peek("user:1", {
      limit: 7,
      windowSeconds: 60,
    });
    expect(decision).toMatchObject({
      allowed: true,
      limit: 7,
      remaining: 7,
      retryAfterSeconds: 0,
      windowSeconds: 60,
    });
  });
});
