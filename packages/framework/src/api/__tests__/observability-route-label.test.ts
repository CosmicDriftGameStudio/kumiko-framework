// The http span and the request metric are labelled with the route pattern, never the raw path:
// path params can be secrets (heartbeat tokens) and every distinct id would be its own series.

import { beforeEach, describe, expect, test } from "bun:test";
import {
  createRecordingProvider,
  type RecordingProvider,
} from "@cosmicdrift/kumiko-testing/helpers";
import { Hono } from "hono";
import { registerStandardMetrics } from "../../observability/standard-metrics.ts";

import { observabilityMiddleware } from "../observability-middleware.ts";

const SECRET = "secret-token-123";

let provider: RecordingProvider;
let app: Hono;

beforeEach(() => {
  provider = createRecordingProvider();
  registerStandardMetrics(provider.meter);
  app = new Hono();
  app.use("/api/*", observabilityMiddleware({ tracer: provider.tracer, meter: provider.meter }));
  app.get("/api/x/:token", (c) => c.json({ ok: true }));
  app.get("/api/boom/:token", () => {
    throw new Error("handler exploded");
  });
  const mounted = new Hono();
  mounted.get("/heartbeat/:token", (c) => c.json({ ok: true }));
  app.route("/api", mounted);
  app.onError((_err, c) => c.json({ error: "boom" }, 500));
  app.notFound((c) => c.text("Not Found", 404));
});

function routeLabels(): string[] {
  return provider.metricEvents.flatMap((event) =>
    event.labels?.["route"] !== undefined ? [String(event.labels["route"])] : [],
  );
}

function everythingEmitted(): string {
  return JSON.stringify({ spans: provider.spans, metrics: provider.metricEvents });
}

describe("observabilityMiddleware route label", () => {
  test("a param route is labelled with its pattern in span name, span attribute and metrics", async () => {
    const res = await app.request(`/api/x/${SECRET}?token=${SECRET}`);
    expect(res.status).toBe(200);

    expect(provider.spans).toHaveLength(1);
    const span = provider.spans[0];
    expect(span?.name).toBe("GET /api/x/:token");
    expect(span?.attributes["http.route"]).toBe("/api/x/:token");
    expect(span?.attributes["http.method"]).toBe("GET");
    expect(span?.attributes).not.toHaveProperty("http.target");
    expect(new Set(routeLabels())).toEqual(new Set(["/api/x/:token"]));
    expect(routeLabels().length).toBeGreaterThan(0);
    expect(everythingEmitted()).not.toContain(SECRET);
  });

  test("a route mounted under a prefix carries the full pattern", async () => {
    expect((await app.request(`/api/heartbeat/${SECRET}`)).status).toBe(200);

    expect(provider.spans[0]?.name).toBe("GET /api/heartbeat/:token");
    expect(provider.spans[0]?.attributes["http.route"]).toBe("/api/heartbeat/:token");
    expect(new Set(routeLabels())).toEqual(new Set(["/api/heartbeat/:token"]));
    expect(everythingEmitted()).not.toContain(SECRET);
  });

  test("two different unmatched paths share the single label unmatched", async () => {
    expect((await app.request("/api/nope/qqq")).status).toBe(404);
    expect((await app.request("/api/other/zzz")).status).toBe(404);

    expect(provider.spans.map((span) => span.name)).toEqual(["GET unmatched", "GET unmatched"]);
    expect(provider.spans.map((span) => span.attributes["http.route"])).toEqual([
      "unmatched",
      "unmatched",
    ]);
    expect(new Set(routeLabels())).toEqual(new Set(["unmatched"]));
    expect(everythingEmitted()).not.toContain("qqq");
    expect(everythingEmitted()).not.toContain("zzz");
  });

  test("a method with no route on the path is unmatched", async () => {
    expect((await app.request(`/api/x/${SECRET}`, { method: "POST" })).status).toBe(404);
    expect(provider.spans[0]?.name).toBe("POST unmatched");
    expect(everythingEmitted()).not.toContain(SECRET);
  });

  test("a throwing handler still carries the pattern label", async () => {
    const res = await app.request(`/api/boom/${SECRET}`);
    expect(res.status).toBe(500);

    const span = provider.spans[0];
    expect(span?.name).toBe("GET /api/boom/:token");
    expect(span?.attributes["http.route"]).toBe("/api/boom/:token");
    expect(new Set(routeLabels())).toEqual(new Set(["/api/boom/:token"]));
    expect(everythingEmitted()).not.toContain(SECRET);
  });

  test.each<[401 | 429, string]>([
    [401, "unauthorized"],
    [429, "rate_limited"],
  ])(
    "a middleware that answers %d before the handler keeps the route pattern",
    async (status, code) => {
      const guarded = new Hono();
      guarded.use(
        "/api/*",
        observabilityMiddleware({ tracer: provider.tracer, meter: provider.meter }),
      );
      guarded.use("/api/*", async (c) => c.json({ error: code }, status));
      guarded.get("/api/x/:token", (c) => c.json({ ok: true }));

      expect((await guarded.request(`/api/x/${SECRET}`)).status).toBe(status);
      expect(provider.spans[0]?.name).toBe("GET /api/x/:token");
      expect(new Set(routeLabels())).toEqual(new Set(["/api/x/:token"]));
      expect(everythingEmitted()).not.toContain(SECRET);
    },
  );
});
