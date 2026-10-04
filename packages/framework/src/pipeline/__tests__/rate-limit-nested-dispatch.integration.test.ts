import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../engine/index.js";
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

const resolver: RateLimitResolver = {
  check: async (_bucket, config) => allow(config),
  enforce: async (bucket, config) => {
    recorded.push({ bucket, config });
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
});
