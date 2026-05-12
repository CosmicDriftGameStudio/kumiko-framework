import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { RateLimitError } from "../../errors";
import { createTestRedis, type TestRedis } from "../../stack";
import {
  createRateLimitResolver,
  type RateLimitDecision,
  type RateLimitResolver,
} from "../resolver";

let testRedis: TestRedis;
let resolver: RateLimitResolver;

// Controllable clock so tests can advance time deterministically without
// real waits. Production passes Date.now; tests inject this so refill
// behaviour is observable in milliseconds.
let mockNowMs: number;

beforeAll(async () => {
  testRedis = await createTestRedis();
});

afterAll(async () => {
  await testRedis.cleanup();
});

beforeEach(async () => {
  await testRedis.flushNamespace();
  mockNowMs = 1_700_000_000_000; // arbitrary fixed start
  resolver = createRateLimitResolver({
    redis: testRedis.redis,
    keyPrefix: "test:rl:",
    nowMs: () => mockNowMs,
  });
});

describe("createRateLimitResolver — token bucket basics", () => {
  test("first N requests within limit are allowed, N+1 is rejected", async () => {
    const config = { limit: 5, windowSeconds: 60 };
    const decisions: RateLimitDecision[] = [];
    for (let i = 0; i < 5; i++) {
      decisions.push(await resolver.check("user:42", config));
    }
    expect(decisions.every((d) => d.allowed)).toBe(true);
    expect(decisions.map((d) => d.remaining)).toEqual([4, 3, 2, 1, 0]);

    const sixth = await resolver.check("user:42", config);
    expect(sixth.allowed).toBe(false);
    expect(sixth.remaining).toBe(0);
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("buckets are isolated by key — different user has fresh bucket", async () => {
    const config = { limit: 2, windowSeconds: 60 };
    await resolver.check("user:a", config);
    await resolver.check("user:a", config);
    const aBlocked = await resolver.check("user:a", config);
    expect(aBlocked.allowed).toBe(false);

    const bFirst = await resolver.check("user:b", config);
    expect(bFirst.allowed).toBe(true);
    expect(bFirst.remaining).toBe(1);
  });

  test("refill: after window/2 the bucket has limit/2 tokens back", async () => {
    const config = { limit: 10, windowSeconds: 10 };
    // Drain the bucket
    for (let i = 0; i < 10; i++) await resolver.check("refill:user", config);
    const drained = await resolver.check("refill:user", config);
    expect(drained.allowed).toBe(false);

    // Advance 5s = window/2 → ~5 tokens refilled
    mockNowMs += 5000;
    const decisions: RateLimitDecision[] = [];
    for (let i = 0; i < 5; i++) {
      decisions.push(await resolver.check("refill:user", config));
    }
    expect(decisions.every((d) => d.allowed)).toBe(true);

    // Sixth in this batch should be blocked again — only 5 tokens were refilled.
    const overshoot = await resolver.check("refill:user", config);
    expect(overshoot.allowed).toBe(false);
  });

  test("refill caps at limit — long idle does not exceed bucket size", async () => {
    const config = { limit: 5, windowSeconds: 10 };
    await resolver.check("idle:user", config);

    // Advance 10× the window → bucket would overflow without the cap.
    mockNowMs += 10 * 10 * 1000;

    const decisions: RateLimitDecision[] = [];
    for (let i = 0; i < 5; i++) {
      decisions.push(await resolver.check("idle:user", config));
    }
    expect(decisions.every((d) => d.allowed)).toBe(true);
    const blocked = await resolver.check("idle:user", config);
    expect(blocked.allowed).toBe(false);
  });
});

describe("createRateLimitResolver — cost", () => {
  test("cost: 5 deducts 5 tokens at once", async () => {
    const config = { limit: 10, windowSeconds: 60, cost: 5 };
    const first = await resolver.check("cost:user", config);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(5);

    const second = await resolver.check("cost:user", config);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);

    const third = await resolver.check("cost:user", config);
    expect(third.allowed).toBe(false);
  });

  test("cost > limit: never allowed", async () => {
    const config = { limit: 5, windowSeconds: 60, cost: 10 };
    const decision = await resolver.check("over:user", config);
    expect(decision.allowed).toBe(false);
  });
});

describe("createRateLimitResolver — concurrency", () => {
  test("100 parallel requests at limit=10 — exactly 10 are allowed", async () => {
    const config = { limit: 10, windowSeconds: 60 };
    // 100 concurrent calls. Lua atomicity → exactly `limit` of them
    // come back allowed=true; the rest are rejected. No double-spend.
    const results = await Promise.all(
      Array.from({ length: 100 }, () => resolver.check("race:user", config)),
    );
    const allowedCount = results.filter((d) => d.allowed).length;
    expect(allowedCount).toBe(10);
  });
});

describe("createRateLimitResolver — peek", () => {
  test("peek returns the same state across consecutive calls — no token deduction", async () => {
    const config = { limit: 5, windowSeconds: 60 };
    // Drain 2 tokens via real check() so the bucket is at remaining=3.
    await resolver.check("peek:user", config);
    await resolver.check("peek:user", config);

    // Three back-to-back peeks at the SAME wallclock — remaining must
    // not move. If peek mutated state, each call would deduct/refill
    // and the numbers would drift.
    const a = await resolver.peek("peek:user", config);
    const b = await resolver.peek("peek:user", config);
    const c = await resolver.peek("peek:user", config);
    expect(a.remaining).toBe(3);
    expect(b.remaining).toBe(3);
    expect(c.remaining).toBe(3);

    // After 100 peeks, the next real check still sees remaining=3-1=2.
    // Proves peek doesn't shift the refill timestamp either — if it did,
    // the next refill maths would over-credit and remaining would jump.
    for (let i = 0; i < 100; i++) await resolver.peek("peek:user", config);
    const next = await resolver.check("peek:user", config);
    expect(next.remaining).toBe(2);
  });

  test("peek on a fresh bucket reports the full limit available", async () => {
    const config = { limit: 7, windowSeconds: 60 };
    const decision = await resolver.peek("peek:fresh", config);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(7);
    expect(decision.limit).toBe(7);
    // Fresh bucket → no need to wait for a refill.
    expect(decision.retryAfterSeconds).toBe(0);
  });
});

describe("createRateLimitResolver — enforce", () => {
  test("enforce throws RateLimitError with the bucket details when blocked", async () => {
    const config = { limit: 1, windowSeconds: 60 };
    await resolver.enforce("enf:user", config);

    let thrown: unknown;
    try {
      await resolver.enforce("enf:user", config);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RateLimitError);
    const err = thrown as RateLimitError;
    expect(err.httpStatus).toBe(429);
    expect(err.code).toBe("rate_limited");
    expect(err.details.bucket).toBe("enf:user");
    expect(err.details.limit).toBe(1);
    expect(err.details.windowSeconds).toBe(60);
    expect(err.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(err.details.resetAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
