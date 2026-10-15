// Server tests via Hono's built-in fetch handler. No real HTTP listen,
// no puppeteer launch — we test the HTTP layer + validation + auth, not
// the render logic itself (that's an integration test).

import { describe, expect, test } from "bun:test";
import type { ServiceConfig } from "../config";
import { createApp } from "../server";

const CONFIG: ServiceConfig = {
  port: 0,
  authToken: "test-token-0123456789abcdef0123456789",
  renderTimeoutMs: 5000,
  maxHtmlBytes: 100_000,
  puppeteerExecutablePath: undefined,
};

function makeAuthHeader(): { Authorization: string } {
  return { Authorization: `Bearer ${CONFIG.authToken}` };
}

describe("GET /healthz", () => {
  test("returns 200 ok", async () => {
    const { app } = createApp(CONFIG);
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("no auth required", async () => {
    const { app } = createApp(CONFIG);
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });
});

describe("GET /metrics", () => {
  test("returns Prometheus-format with zero counters initially", async () => {
    const { app } = createApp(CONFIG);
    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("puppeteer_renders_total");
    expect(body).toContain('kind="document-pdf"} 0');
    expect(body).toContain('kind="image-snapshot"} 0');
    expect(body).toContain("puppeteer_render_errors_total 0");
  });

  test("Content-Type ist text/plain mit Prometheus-version", async () => {
    const { app } = createApp(CONFIG);
    const res = await app.request("/metrics");
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(res.headers.get("Content-Type")).toContain("version=0.0.4");
  });
});

describe("POST /render — Auth", () => {
  test("ohne Authorization-Header → 401", async () => {
    const { app } = createApp(CONFIG);
    const res = await app.request("/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "document-pdf", html: "<p>test</p>" }),
    });
    expect(res.status).toBe(401);
  });

  test("falscher Token → 401", async () => {
    const { app } = createApp(CONFIG);
    const res = await app.request("/render", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-token" },
      body: JSON.stringify({ kind: "document-pdf", html: "<p>test</p>" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /render — Validation", () => {
  test("invalid JSON → 400", async () => {
    const { app } = createApp(CONFIG);
    const res = await app.request("/render", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...makeAuthHeader() },
      body: "not json{{{",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_payload");
  });

  test("unknown kind → 400", async () => {
    const { app } = createApp(CONFIG);
    const res = await app.request("/render", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...makeAuthHeader() },
      body: JSON.stringify({ kind: "video-mp4", html: "<p>test</p>" }),
    });
    expect(res.status).toBe(400);
  });

  test("empty html → 400", async () => {
    const { app } = createApp(CONFIG);
    const res = await app.request("/render", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...makeAuthHeader() },
      body: JSON.stringify({ kind: "document-pdf", html: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("html-too-large → 413", async () => {
    const { app } = createApp(CONFIG);
    const largeHtml = "x".repeat(CONFIG.maxHtmlBytes + 100);
    const res = await app.request("/render", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...makeAuthHeader() },
      body: JSON.stringify({ kind: "document-pdf", html: largeHtml }),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; maxBytes: number };
    expect(body.error).toMatch(/too_large/);
    expect(body.maxBytes).toBe(CONFIG.maxHtmlBytes);
  });

  test("image-snapshot mit invalid width → 400", async () => {
    const { app } = createApp(CONFIG);
    const res = await app.request("/render", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...makeAuthHeader() },
      body: JSON.stringify({
        kind: "image-snapshot",
        html: "<p>test</p>",
        options: { width: 9999 }, // max 4000
      }),
    });
    expect(res.status).toBe(400);
  });
});
