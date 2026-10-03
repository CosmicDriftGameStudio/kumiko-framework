// r.httpRoute({ rateLimit }): the route's own per-IP limit, enforced through
// the server's rate-limit resolver before the handler (and guards) run.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defineFeature } from "../../engine/index.js";
import { setupTestStack, type TestStack } from "../../stack/index.js";

let handlerCalls = 0;

const limitedFeature = defineFeature("rl-route", (r) => {
  r.httpRoute({
    method: "GET",
    path: "/limited-a",
    anonymous: true,
    rateLimit: { per: "ip+handler", limit: 2, windowSeconds: 60 },
    handler: async (c) => {
      handlerCalls++;
      return c.text("a");
    },
  });
  r.httpRoute({
    method: "GET",
    path: "/limited-b",
    anonymous: true,
    rateLimit: { per: "ip+handler", limit: 2, windowSeconds: 60 },
    handler: async (c) => c.text("b"),
  });
  r.httpRoute({
    method: "GET",
    path: "/unlimited",
    anonymous: true,
    handler: async (c) => c.text("open"),
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [limitedFeature], trustedProxyHops: 1 });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  handlerCalls = 0;
  await stack.redis.flushNamespace();
});

async function getAs(path: string, ip: string): Promise<Response> {
  return stack.app.request(path, { headers: { "x-forwarded-for": ip } });
}

describe("r.httpRoute rateLimit", () => {
  test("the call over the limit answers 429 with Retry-After and never reaches the handler", async () => {
    expect((await getAs("/limited-a", "9.9.8.1")).status).toBe(200);
    expect((await getAs("/limited-a", "9.9.8.1")).status).toBe(200);
    const blocked = await getAs("/limited-a", "9.9.8.1");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).not.toBeNull();
    expect(handlerCalls).toBe(2);
  });

  test("per ip+handler: another route and another IP keep their own bucket", async () => {
    await getAs("/limited-a", "9.9.8.2");
    await getAs("/limited-a", "9.9.8.2");
    expect((await getAs("/limited-a", "9.9.8.2")).status).toBe(429);
    expect((await getAs("/limited-b", "9.9.8.2")).status).toBe(200);
    expect((await getAs("/limited-a", "9.9.8.3")).status).toBe(200);
  });

  test("a route without rateLimit is never throttled", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await getAs("/unlimited", "9.9.8.4")).status).toBe(200);
    }
  });
});

describe("r.httpRoute rateLimit validation", () => {
  test("rejects a non-positive limit at feature definition", () => {
    expect(() =>
      defineFeature("rl-route-bad", (r) => {
        r.httpRoute({
          method: "GET",
          path: "/bad",
          anonymous: true,
          rateLimit: { per: "ip", limit: 0, windowSeconds: 60 },
          handler: async (c) => c.text("x"),
        });
      }),
    ).toThrow(/positive integer limit and windowSeconds/);
  });
});
