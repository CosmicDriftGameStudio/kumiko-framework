// extraRoutes { rateLimit }: the route's own per-IP limit, enforced through the server's
// rate-limit resolver before the body limit, verify() and the handler. The probe feature
// declares no rateLimit itself, so the resolver only exists because an extra route asks for it.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createRegistry, defineFeature } from "../../engine/index.ts";
import { type ExtraRouteDefinition, signatureRoute } from "../extra-route.ts";
import { buildServer } from "../server.ts";

const JWT_SECRET = "test-extra-route-rl-secret-32-chars-min!";

let handlerCalls = 0;
let verifyCalls = 0;
let keyedHandlerCalls = 0;

const probe = defineFeature("extra-rl-probe", (r) => {
  r.queryHandler({
    name: "noop",
    schema: z.object({}),
    access: { roles: ["User", "Admin"] },
    handler: async () => ({}),
  });
});

const extraRoutes: readonly ExtraRouteDefinition[] = [
  {
    method: "GET",
    path: "/public/limited-a",
    entry: "anonymous",
    rateLimit: { per: "ip+handler", limit: 2, windowSeconds: 60 },
    handler: async (c) => {
      handlerCalls++;
      return c.text("a");
    },
  },
  {
    method: "GET",
    path: "/public/limited-b",
    entry: "anonymous",
    rateLimit: { per: "ip+handler", limit: 2, windowSeconds: 60 },
    handler: async (c) => c.text("b"),
  },
  {
    method: "GET",
    path: "/public/unlimited",
    entry: "anonymous",
    handler: async (c) => c.text("open"),
  },
  signatureRoute({
    method: "POST",
    path: "/hooks/limited",
    entry: "signature",
    rateLimit: { per: "ip", limit: 1, windowSeconds: 60 },
    verify: async () => {
      verifyCalls++;
      return true;
    },
    handler: async (c) => c.text("ok"),
  }),
  signatureRoute({
    method: "POST",
    path: "/hooks/per-app",
    entry: "signature",
    verify: async (request) => ({ appId: request.headers["x-app-id"] ?? "none" }),
    verifiedRateLimit: {
      key: (verified) => verified.appId,
      limit: 1,
      windowSeconds: 60,
      rejectionBody: (decision) => ({
        type: "error",
        error: { type: "rate_limit_error", retryAfterSeconds: decision.retryAfterSeconds },
      }),
    },
    handler: async (c) => {
      keyedHandlerCalls++;
      return c.text("ok");
    },
  }),
  signatureRoute({
    method: "POST",
    path: "/hooks/per-app-default",
    entry: "signature",
    verify: async () => ({ appId: "fixed" }),
    verifiedRateLimit: { key: (verified) => verified.appId, limit: 1, windowSeconds: 60 },
    handler: async (c) => c.text("ok"),
  }),
];

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [probe], extraRoutes, trustedProxyHops: 1 });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  handlerCalls = 0;
  verifyCalls = 0;
  keyedHandlerCalls = 0;
  await stack.redis.flushNamespace();
});

async function callAs(
  method: "GET" | "POST",
  path: string,
  ip: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return stack.app.request(path, {
    method,
    headers: { "x-forwarded-for": ip, ...extraHeaders },
  });
}

describe("extraRoutes rateLimit", () => {
  test("the call over the limit answers 429 with Retry-After and never reaches the handler", async () => {
    expect((await callAs("GET", "/public/limited-a", "9.9.7.1")).status).toBe(200);
    expect((await callAs("GET", "/public/limited-a", "9.9.7.1")).status).toBe(200);
    const blocked = await callAs("GET", "/public/limited-a", "9.9.7.1");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).not.toBeNull();
    const body = (await blocked.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
    expect(handlerCalls).toBe(2);
  });

  test("ip+handler keeps one bucket per route and per IP", async () => {
    await callAs("GET", "/public/limited-a", "9.9.7.2");
    await callAs("GET", "/public/limited-a", "9.9.7.2");
    expect((await callAs("GET", "/public/limited-a", "9.9.7.2")).status).toBe(429);
    expect((await callAs("GET", "/public/limited-b", "9.9.7.2")).status).toBe(200);
    expect((await callAs("GET", "/public/limited-a", "9.9.7.3")).status).toBe(200);
  });

  test("a signature route is limited before verify() runs", async () => {
    expect((await callAs("POST", "/hooks/limited", "9.9.7.4")).status).toBe(200);
    expect((await callAs("POST", "/hooks/limited", "9.9.7.4")).status).toBe(429);
    expect(verifyCalls).toBe(1);
  });

  test("an extra route without rateLimit is never throttled", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await callAs("GET", "/public/unlimited", "9.9.7.5")).status).toBe(200);
    }
  });
});

describe("extraRoutes verifiedRateLimit", () => {
  test("each verified key has its own bucket and the 429 carries the route's body", async () => {
    const ip = "9.9.7.6";
    expect((await callAs("POST", "/hooks/per-app", ip, { "x-app-id": "app-a" })).status).toBe(200);
    const blocked = await callAs("POST", "/hooks/per-app", ip, { "x-app-id": "app-a" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).not.toBeNull();
    const body = (await blocked.json()) as { error: { type: string } };
    expect(body.error.type).toBe("rate_limit_error");
    expect((await callAs("POST", "/hooks/per-app", ip, { "x-app-id": "app-b" })).status).toBe(200);
    expect(keyedHandlerCalls).toBe(2);
  });

  test("without rejectionBody the 429 is the framework's rate_limited error", async () => {
    const ip = "9.9.7.7";
    expect((await callAs("POST", "/hooks/per-app-default", ip)).status).toBe(200);
    const blocked = await callAs("POST", "/hooks/per-app-default", ip);
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  });
});

describe("extraRoutes rateLimit validation", () => {
  test("rejects a non-positive limit at boot", () => {
    expect(() =>
      buildServer({
        registry: createRegistry([probe]),
        context: {},
        jwtSecret: JWT_SECRET,
        extraRoutes: [
          {
            method: "GET",
            path: "/public/bad",
            entry: "anonymous",
            rateLimit: { per: "ip", limit: 0, windowSeconds: 60 },
            handler: async (c) => c.text("x"),
          },
        ],
      }),
    ).toThrow(/rateLimit needs positive integer\s+limit and windowSeconds/);
  });

  test("rejects a non-positive verifiedRateLimit at boot", () => {
    expect(() =>
      buildServer({
        registry: createRegistry([probe]),
        context: {},
        jwtSecret: JWT_SECRET,
        extraRoutes: [
          signatureRoute({
            method: "POST",
            path: "/hooks/bad",
            entry: "signature",
            verify: async () => ({ appId: "x" }),
            verifiedRateLimit: { key: (v) => v.appId, limit: 0, windowSeconds: 60 },
            handler: async (c) => c.text("x"),
          }),
        ],
      }),
    ).toThrow(/verifiedRateLimit needs positive integer\s+limit and windowSeconds/);
  });
});
