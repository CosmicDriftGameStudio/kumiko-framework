import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../engine/index.js";
import { RateLimitError } from "../../errors/index.js";
import type {
  RateLimitConfig,
  RateLimitDecision,
  RateLimitResolver,
} from "../../rate-limit/index.js";
import { createTestUser, setupTestStack, type TestStack, testTenantId } from "../../stack/index.js";

const recorded: Array<{ bucket: string; config: RateLimitConfig }> = [];

function allow(config: RateLimitConfig): RateLimitDecision {
  return {
    allowed: true,
    limit: config.limit,
    remaining: config.limit - 1,
    retryAfterSeconds: 0,
    windowSeconds: config.windowSeconds,
    // @cast-boundary test-fixture — resetAt is never read by the assertions below
    resetAt: undefined as unknown as RateLimitDecision["resetAt"],
  };
}

let denyUserBucket = false;

const resolver: RateLimitResolver = {
  check: async (_bucket, config) => allow(config),
  enforce: async (bucket, config) => {
    recorded.push({ bucket, config });
    if (denyUserBucket && bucket.startsWith("user:")) {
      throw new RateLimitError({
        bucket,
        limit: config.limit,
        windowSeconds: config.windowSeconds,
        remaining: 0,
        retryAfterSeconds: 1,
        resetAt: "1970-01-01T00:00:00.000Z",
      });
    }
    return allow(config);
  },
  peek: async (_bucket, config) => allow(config),
};

const ipLimit = { per: "ip", limit: 60, windowSeconds: 60 } as const;

const nestedFeature = defineFeature("rl-nested", (r) => {
  r.queryHandler("inner-ip", z.object({}), async () => ({ ok: true }), {
    access: { roles: ["Admin"] },
    rateLimit: ipLimit,
  });
  r.queryHandler("inner-user", z.object({}), async () => ({ ok: true }), {
    access: { roles: ["Admin"] },
    rateLimit: { per: "user", limit: 60, windowSeconds: 60 },
  });
  r.queryHandler(
    "outer-same-bucket",
    z.object({}),
    async (_event, ctx) => ({ inner: await ctx.query("rl-nested:query:inner-ip", {}) }),
    { access: { roles: ["Admin"] }, rateLimit: ipLimit },
  );
  r.queryHandler(
    "outer-other-bucket",
    z.object({}),
    async (_event, ctx) => ({ inner: await ctx.query("rl-nested:query:inner-user", {}) }),
    { access: { roles: ["Admin"] }, rateLimit: ipLimit },
  );
  r.queryHandler("inner-ip-strict", z.object({}), async () => ({ ok: true }), {
    access: { roles: ["Admin"] },
    rateLimit: { per: "ip", limit: 5, windowSeconds: 60 },
  });
  r.queryHandler(
    "outer-stricter-nested",
    z.object({}),
    async (_event, ctx) => ({ inner: await ctx.query("rl-nested:query:inner-ip-strict", {}) }),
    { access: { roles: ["Admin"] }, rateLimit: ipLimit },
  );
  r.queryHandler(
    "outer-retry-after-denial",
    z.object({}),
    async (_event, ctx) => {
      const outcomes: boolean[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await ctx.query("rl-nested:query:inner-user", {});
          outcomes.push(true);
        } catch {
          outcomes.push(false);
        }
      }
      return { outcomes };
    },
    { access: { roles: ["Admin"] }, rateLimit: ipLimit },
  );
  r.writeHandler("touch", z.object({}), async () => ({ isSuccess: true as const, data: {} }), {
    access: { roles: ["Admin"] },
    rateLimit: { per: "user", limit: 60, windowSeconds: 60 },
  });
});

let stack: TestStack;
const admin = createTestUser({ tenantId: testTenantId(9301), roles: ["Admin"] });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [nestedFeature],
    extraContext: { rateLimit: resolver },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("rate limit counts a request once per bucket, however many handlers it nests", () => {
  test("a nested query hitting the same bucket costs no second token", async () => {
    recorded.length = 0;
    const res = await stack.http.query("rl-nested:query:outer-same-bucket", {}, admin);
    expect(res.status).toBe(200);
    expect(recorded.map((entry) => entry.bucket.split(":")[0])).toEqual(["ip"]);
  });

  test("a nested query with a different bucket is still limited on its own bucket", async () => {
    recorded.length = 0;
    const res = await stack.http.query("rl-nested:query:outer-other-bucket", {}, admin);
    expect(res.status).toBe(200);
    expect(recorded.map((entry) => entry.bucket.split(":")[0]).sort()).toEqual(["ip", "user"]);
  });

  test("each command of a batch is its own entry dispatch and charges its bucket", async () => {
    recorded.length = 0;
    const res = await stack.http.batch(
      [
        { type: "rl-nested:write:touch", payload: {} },
        { type: "rl-nested:write:touch", payload: {} },
      ],
      admin,
    );
    expect(res.status).toBe(200);
    expect(recorded.map((entry) => entry.bucket.split(":")[0])).toEqual(["user", "user"]);
  });

  test("a nested call with a stricter limit on the same bucket is still enforced", async () => {
    recorded.length = 0;
    const res = await stack.http.query("rl-nested:query:outer-stricter-nested", {}, admin);
    expect(res.status).toBe(200);
    expect(recorded.map((entry) => entry.config.limit)).toEqual([60, 5]);
  });

  test("a denied nested check is not remembered: a retry in the same request is checked again", async () => {
    recorded.length = 0;
    denyUserBucket = true;
    try {
      const res = await stack.http.query("rl-nested:query:outer-retry-after-denial", {}, admin);
      expect(res.status).toBe(200);
      expect(recorded.filter((entry) => entry.bucket.startsWith("user:"))).toHaveLength(2);
    } finally {
      denyUserBucket = false;
    }
  });
});
