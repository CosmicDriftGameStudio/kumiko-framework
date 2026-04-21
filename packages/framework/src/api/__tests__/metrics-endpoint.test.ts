import { describe, expect, test } from "vitest";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";
import {
  createNoopProvider,
  createPrometheusMeter,
  type ObservabilityProvider,
} from "../../observability";
import { buildServer } from "../server";

const JWT = "metrics-endpoint-test-secret-minimum-32-chars!!";

const noopFeature = defineFeature("m", (r) => {
  r.entity("widget", createEntity({ table: "Widgets", fields: { name: createTextField() } }));
});

// Swap the NoopProvider's meter for a PrometheusMeter. Tracer + lifecycle
// stay noop — /metrics only reads the meter.
function makeProvider(): {
  provider: ObservabilityProvider;
  meter: ReturnType<typeof createPrometheusMeter>;
} {
  const meter = createPrometheusMeter();
  const base = createNoopProvider();
  const provider: ObservabilityProvider = { ...base, meter };
  return { provider, meter };
}

function makeApp(opts: {
  metrics?: { token?: string; path?: string };
  meter?: ReturnType<typeof createPrometheusMeter>;
  provider?: ObservabilityProvider;
}) {
  const registry = createRegistry([noopFeature]);
  const build = opts.provider
    ? { provider: opts.provider, meter: opts.meter ?? null }
    : makeProvider();
  const args = {
    registry,
    context: {},
    jwtSecret: JWT,
    observability: build.provider,
    ...(opts.metrics ? { metrics: opts.metrics } : {}),
  };
  return { ...buildServer(args), meter: build.meter };
}

describe("/metrics endpoint", () => {
  test("returns 404 when `metrics` option is not wired (opt-in)", async () => {
    const { app } = makeApp({});
    const res = await app.request("/metrics");
    expect(res.status).toBe(404);
  });

  test("returns OpenMetrics text when wired and meter is a PrometheusMeter", async () => {
    const { app, meter } = makeApp({ metrics: {} });
    if (!meter) throw new Error("meter missing");
    // Seed a single metric so the output isn't empty.
    meter.registerMetric({
      name: "kumiko_test_total",
      type: "counter",
      description: "probe counter",
    });
    meter.counter("kumiko_test_total").inc(3);

    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/openmetrics-text/);
    const body = await res.text();
    expect(body).toContain("# HELP kumiko_test_total probe counter");
    expect(body).toContain("# TYPE kumiko_test_total counter");
    expect(body).toContain("kumiko_test_total 3");
    expect(body).toMatch(/# EOF\n$/);
  });

  test("token-protected: rejects missing header with 401", async () => {
    const { app } = makeApp({ metrics: { token: "scrape-secret-xyz" } });
    const res = await app.request("/metrics");
    expect(res.status).toBe(401);
  });

  test("token-protected: rejects wrong token with 401", async () => {
    const { app } = makeApp({ metrics: { token: "scrape-secret-xyz" } });
    const res = await app.request("/metrics", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  test("token-protected: accepts matching Bearer token", async () => {
    const { app, meter } = makeApp({ metrics: { token: "scrape-secret-xyz" } });
    if (!meter) throw new Error("meter missing");
    meter.registerMetric({ name: "kumiko_probe", type: "counter" });
    meter.counter("kumiko_probe").inc();

    const res = await app.request("/metrics", {
      headers: { Authorization: "Bearer scrape-secret-xyz" },
    });
    expect(res.status).toBe(200);
  });

  test("custom path: /internal/metrics", async () => {
    const { app, meter } = makeApp({ metrics: { path: "/internal/metrics" } });
    if (!meter) throw new Error("meter missing");
    meter.registerMetric({ name: "kumiko_probe", type: "counter" });

    const atDefault = await app.request("/metrics");
    expect(atDefault.status).toBe(404);

    const atCustom = await app.request("/internal/metrics");
    expect(atCustom.status).toBe(200);
  });

  test("503 when meter lacks snapshot() (misconfig — non-Prometheus provider)", async () => {
    // Build a provider whose meter is a raw non-Prometheus implementation —
    // pretend it's a ConsoleProvider or an OTLP bridge without snapshot().
    const { createNoopProvider } = await import("../../observability");
    const provider = createNoopProvider();
    // NoopProvider is "empty by design", register a metric so definitions
    // isn't hollow, but snapshot() is still absent on the meter shape.
    provider.meter.registerMetric({ name: "kumiko_noop", type: "counter" });
    const { app } = makeApp({ provider, metrics: {} });
    const res = await app.request("/metrics");
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("PrometheusMeter");
  });
});
