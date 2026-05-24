import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createTestRedis, type TestRedis } from "../../stack";
import { authEndpointRateLimit, globalIpRateLimit } from "../middleware";
import { createRateLimitResolver, type RateLimitResolver } from "../resolver";

let testRedis: TestRedis;
let resolver: RateLimitResolver;

beforeAll(async () => {
  testRedis = await createTestRedis();
});

afterAll(async () => {
  await testRedis.cleanup();
});

beforeEach(async () => {
  await testRedis.flushNamespace();
  resolver = createRateLimitResolver({
    redis: testRedis.redis,
    keyPrefix: "test:rl:",
  });
});

describe("globalIpRateLimit (L1)", () => {
  test("allows up to limit, blocks at limit+1, returns 429 with headers", async () => {
    const app = new Hono();
    app.use(
      "/api/*",
      globalIpRateLimit({ resolver, limit: 3, windowSeconds: 60, onFailClosed: () => {} }),
    );
    app.get("/api/probe", (c) => c.text("ok"));

    const ipHeader = { "x-forwarded-for": "10.0.0.1" };
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/api/probe", { headers: ipHeader });
      expect(res.status).toBe(200);
      // Allowed responses carry the standard headers so a polite client
      // can self-throttle without first hitting 429.
      expect(res.headers.get("X-RateLimit-Limit")).toBe("3");
      expect(res.headers.get("X-RateLimit-Remaining")).toBe(String(2 - i));
    }
    const blocked = await app.request("/api/probe", { headers: ipHeader });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(blocked.headers.get("X-RateLimit-Limit")).toBe("3");
    expect(blocked.headers.get("X-RateLimit-Remaining")).toBe("0");

    const body = (await blocked.json()) as { error: { code: string; details: { bucket: string } } };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.details.bucket).toBe("l1:10.0.0.1");
  });

  test("isolates per IP — different x-forwarded-for has its own bucket", async () => {
    const app = new Hono();
    app.use(
      "/api/*",
      globalIpRateLimit({ resolver, limit: 2, windowSeconds: 60, onFailClosed: () => {} }),
    );
    app.get("/api/probe", (c) => c.text("ok"));

    await app.request("/api/probe", { headers: { "x-forwarded-for": "10.0.0.2" } });
    await app.request("/api/probe", { headers: { "x-forwarded-for": "10.0.0.2" } });
    const blocked = await app.request("/api/probe", {
      headers: { "x-forwarded-for": "10.0.0.2" },
    });
    expect(blocked.status).toBe(429);

    const otherIp = await app.request("/api/probe", {
      headers: { "x-forwarded-for": "10.0.0.99" },
    });
    expect(otherIp.status).toBe(200);
  });

  test("no x-forwarded-for: pass-through (no bucket)", async () => {
    const app = new Hono();
    app.use(
      "/api/*",
      globalIpRateLimit({ resolver, limit: 1, windowSeconds: 60, onFailClosed: () => {} }),
    );
    app.get("/api/probe", (c) => c.text("ok"));

    // No xff header — extractIp returns undefined → middleware skips.
    // Both calls succeed even though limit=1.
    const a = await app.request("/api/probe");
    const b = await app.request("/api/probe");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  test("fail-closed when resolver throws non-RateLimit error (Redis down)", async () => {
    let onFailCalled = false;
    const brokenResolver: RateLimitResolver = {
      check: async () => {
        throw new Error("ECONNREFUSED");
      },
      enforce: async () => {
        throw new Error("ECONNREFUSED");
      },
      peek: async () => {
        throw new Error("ECONNREFUSED");
      },
    };

    const app = new Hono();
    app.use(
      "/api/*",
      globalIpRateLimit({
        resolver: brokenResolver,
        limit: 5,
        windowSeconds: 60,
        onFailClosed: () => {
          onFailCalled = true;
        },
      }),
    );
    app.get("/api/probe", (c) => c.text("ok"));

    const res = await app.request("/api/probe", {
      headers: { "x-forwarded-for": "10.0.0.5" },
    });
    expect(res.status).toBe(503);
    expect(onFailCalled).toBe(true);
  });
});

describe("authEndpointRateLimit (L2)", () => {
  test("default bucket is ip+path: same IP on different path is independent", async () => {
    const app = new Hono();
    app.use(
      "/auth/*",
      authEndpointRateLimit({
        resolver,
        limit: 2,
        windowSeconds: 60,
        onFailClosed: () => {},
      }),
    );
    app.post("/auth/login", (c) => c.text("ok"));
    app.post("/auth/register", (c) => c.text("ok"));

    const ipHeader = { "x-forwarded-for": "10.0.1.1" };
    await app.request("/auth/login", { method: "POST", headers: ipHeader });
    await app.request("/auth/login", { method: "POST", headers: ipHeader });
    const blocked = await app.request("/auth/login", { method: "POST", headers: ipHeader });
    expect(blocked.status).toBe(429);

    // Different path → separate bucket — register endpoint not affected.
    const register = await app.request("/auth/register", { method: "POST", headers: ipHeader });
    expect(register.status).toBe(200);
  });

  test("custom extractTarget: account-aware bucketing isolates per email", async () => {
    const app = new Hono();
    app.use(
      "/auth/login",
      authEndpointRateLimit({
        resolver,
        limit: 2,
        windowSeconds: 60,
        extractTarget: async (c) => {
          // Real-world: parse JSON body for `email`. Tests pass the
          // email as a header for simplicity (body-stream consumption
          // mid-middleware needs a body-shim that's out of scope here).
          return c.req.header("x-account") ?? undefined;
        },
        onFailClosed: () => {},
      }),
    );
    app.post("/auth/login", (c) => c.text("ok"));

    const ipHeader = { "x-forwarded-for": "10.0.1.5" };
    const reqA = (acc: string) =>
      app.request("/auth/login", {
        method: "POST",
        headers: { ...ipHeader, "x-account": acc },
      });

    await reqA("user-a");
    await reqA("user-a");
    const blockedA = await reqA("user-a");
    expect(blockedA.status).toBe(429);

    // Same IP, different account → fresh bucket
    const otherAcc = await reqA("user-b");
    expect(otherAcc.status).toBe(200);
  });
});
