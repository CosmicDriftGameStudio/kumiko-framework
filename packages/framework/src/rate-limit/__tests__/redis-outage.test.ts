import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { Redis } from "ioredis";
import { createClientIpResolver } from "../../api/client-ip.ts";
import { logRedisConnectionState } from "../../redis/client.ts";
import { authEndpointRateLimit, globalIpRateLimit, httpRouteRateLimit } from "../middleware.ts";
import { createRateLimitResolver } from "../resolver.ts";

// Port 1 refuses connections: the client never reaches "ready", like a Redis that is down.
function unreachableRedis(): Redis {
  return new Redis("redis://127.0.0.1:1", { maxRetriesPerRequest: null, retryStrategy: () => 50 });
}

describe("rate limiting while Redis is unreachable", () => {
  let redis: Redis;
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;
  let errorSpy: ReturnType<typeof spyOn<Console, "error">>;

  beforeEach(() => {
    redis = unreachableRedis();
    redis.on("error", () => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    redis.disconnect();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function appWithAllLimiters(): Hono {
    const resolver = createRateLimitResolver({ redis });
    const clientIpResolver = createClientIpResolver(0);
    const app = new Hono();
    app.use("/api/*", globalIpRateLimit({ resolver, clientIpResolver }));
    app.use("/api/auth/*", authEndpointRateLimit({ resolver, clientIpResolver }));
    app.use(
      "/hook",
      httpRouteRateLimit({
        resolver,
        clientIpResolver,
        routeKey: "POST /hook",
        rateLimit: { per: "ip", limit: 5, windowSeconds: 60 },
      }),
    );
    app.get("/api/ping", (c) => c.text("ok"));
    app.post("/hook", (c) => c.text("ok"));
    return app;
  }

  test("the global IP limit fails open and answers immediately instead of waiting for a command timeout", async () => {
    const startedAt = performance.now();

    const res = await appWithAllLimiters().request("/api/ping");

    expect(res.status).toBe(200);
    expect(performance.now() - startedAt).toBeLessThan(1000);
  });

  test("an http-route limit fails open", async () => {
    const res = await appWithAllLimiters().request("/hook", { method: "POST" });

    expect(res.status).toBe(200);
  });

  test("the auth-endpoint limit stays fail-closed with 503", async () => {
    const res = await appWithAllLimiters().request("/api/auth/login", { method: "POST" });

    expect(res.status).toBe(503);
  });

  test("repeated fail-open requests warn only once per 30 seconds", async () => {
    const app = appWithAllLimiters();

    await app.request("/api/ping");
    await app.request("/api/ping");
    await app.request("/api/ping");

    const failOpenWarnings = warnSpy.mock.calls.filter((call) =>
      JSON.stringify(call).includes("failing open"),
    );
    expect(failOpenWarnings).toHaveLength(1);
  });
});

describe("logRedisConnectionState", () => {
  test("logs the loss once and the recovery once, without crashing", async () => {
    const redis = unreachableRedis();
    const events: string[] = [];
    logRedisConnectionState(redis, {
      warn: (msg) => events.push(msg),
      info: (msg) => events.push(msg),
    });
    try {
      await new Promise<void>((resolve) => redis.once("error", () => resolve()));
      await new Promise<void>((resolve) => redis.once("error", () => resolve()));

      redis.emit("ready");
      redis.emit("ready");

      expect(events).toEqual(["redis connection lost, reconnecting", "redis recovered"]);
    } finally {
      redis.disconnect();
    }
  });
});
