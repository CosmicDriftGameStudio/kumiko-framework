import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineFeature } from "../../engine";
import { resolveObservabilityWiring } from "../../observability/metrics-wiring";
import { setupTestStack, type TestStack } from "../test-stack";
import { TestUsers } from "../test-users";

const METRICS_TOKEN = "setup-test-stack-metrics-token-minimum-32-chars!!";

const pingFeature = defineFeature("stmetrics", (r) => {
  r.writeHandler(
    "ping",
    z.object({}),
    async () => ({ isSuccess: true as const, data: { ok: true } }),
    { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  );
});

let stack: TestStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

describe("setupTestStack metrics option (integration)", () => {
  test("mirrors runProdApp wiring: /metrics scrapes after a real request, token-gated", async () => {
    stack = await setupTestStack({
      features: [pingFeature],
      ...resolveObservabilityWiring(METRICS_TOKEN),
    });

    // kumiko_http_requests_total is only recorded by the http middleware, so scrape after a real request.
    await stack.http.command("stmetrics:write:ping", {}, TestUsers.admin);

    const noAuth = await stack.app.request("/metrics");
    expect(noAuth.status).toBe(401);

    const wrongToken = await stack.app.request("/metrics", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(wrongToken.status).toBe(401);

    const scraped = await stack.app.request("/metrics", {
      headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
    });
    expect(scraped.status).toBe(200);
    expect(scraped.headers.get("Content-Type")).toMatch(/openmetrics-text/);
    const body = await scraped.text();
    expect(body).toMatch(/kumiko_http_requests_total\{[^}]*route="\/api\/command"[^}]*\} 1/);
  });

  test("no metrics option: /metrics is unmounted (404)", async () => {
    stack = await setupTestStack({ features: [pingFeature] });

    const res = await stack.app.request("/metrics");
    expect(res.status).toBe(404);
  });

  test("custom path override: mounts only at the overridden path", async () => {
    const wiring = resolveObservabilityWiring(METRICS_TOKEN);
    if (!("metrics" in wiring)) throw new Error("resolveObservabilityWiring did not wire metrics");

    stack = await setupTestStack({
      features: [pingFeature],
      ...wiring,
      metrics: { ...wiring.metrics, path: "/internal/metrics" },
    });

    const atDefault = await stack.app.request("/metrics");
    expect(atDefault.status).toBe(404);

    const atCustom = await stack.app.request("/internal/metrics", {
      headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
    });
    expect(atCustom.status).toBe(200);
    expect(atCustom.headers.get("Content-Type")).toMatch(/openmetrics-text/);
  });
});
