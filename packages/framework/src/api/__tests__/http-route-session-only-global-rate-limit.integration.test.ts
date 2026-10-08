// r.httpRoute({ anonymous: false }) lives outside /api/*, so it must re-attach
// the global IP limit itself: an unauthenticated flood may not reach JWT verify.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defineFeature } from "../../engine/index.js";
import { setupTestStack, type TestStack } from "../../stack/index.js";

const privateRouteFeature = defineFeature("session-only-rl", (r) => {
  r.httpRoute({
    method: "GET",
    path: "/session-only-private",
    anonymous: false,
    handler: async (c) => c.json({ ok: true }),
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [privateRouteFeature],
    trustedProxyHops: 1,
    rateLimit: { global: { limit: 2, windowSeconds: 60 } },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.redis.flushNamespace();
});

describe("anonymous: false httpRoute and rateLimit.global", () => {
  test("unauthenticated calls over the global limit answer 429 before auth runs", async () => {
    const call = () =>
      stack.app.request("/session-only-private", { headers: { "x-forwarded-for": "9.9.7.1" } });
    expect((await call()).status).toBe(401);
    expect((await call()).status).toBe(401);
    expect((await call()).status).toBe(429);
  });
});
