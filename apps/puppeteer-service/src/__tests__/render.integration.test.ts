// Integration test with a real puppeteer launch. Closes the gap left by the
// unit tests (which only exercise auth + validation, not the render path).
// The README smoke test is manual and prone to drift.

import { afterAll, describe, expect, test } from "bun:test";
import { countPdfPages } from "@cosmicdrift/kumiko-renderer-puppeteer-client";
import type { ServiceConfig } from "../config";
import { shutdownBrowser } from "../render";
import { createApp } from "../server";

// Opt-in gate (enterprise#254): CI must not silently skip forever.
// Local / heavy runners: PUPPETEER_RENDER_TESTS=1 bun test …
const RUN_RENDER_TESTS = process.env["PUPPETEER_RENDER_TESTS"] === "1";

const CONFIG: ServiceConfig = {
  port: 0,
  authToken: "integration-test-token-0123456789abcdef0123",
  renderTimeoutMs: 15_000,
  maxHtmlBytes: 100_000,
  puppeteerExecutablePath: undefined,
};

afterAll(async () => {
  await shutdownBrowser();
});

// Always-on in CI: if Chrome launches successfully, the arm64 blocker (#75)
// is gone — fail so the opt-in skips below get removed.
describe("Chrome launch smoke (#75)", () => {
  test("successful launch in CI means PUPPETEER_RENDER_TESTS skips should be removed", async () => {
    const inCi = process.env["CI"] === "true" || process.env["CI"] === "1";
    if (!inCi) return;
    const { getBrowserForSmoke } = await import("../render");
    try {
      await getBrowserForSmoke();
      expect.unreachable("Blocker #75 weg — Skips entfernen (PUPPETEER_RENDER_TESTS gate)");
    } catch {
      // Chrome still cannot launch on this runner — blocker remains.
    } finally {
      await shutdownBrowser();
    }
  });
});

// skip: arm64 Chrome won't launch on cdgs-runner (#75/#253); opt-in via PUPPETEER_RENDER_TESTS=1
describe.skipIf(!RUN_RENDER_TESTS)("POST /render — echtes Puppeteer-Rendering", () => {
  test("kind=document-pdf liefert valid PDF mit magic-bytes %PDF-", async () => {
    const { app } = createApp(CONFIG);
    const res = await app.request("/render", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.authToken}`,
      },
      body: JSON.stringify({
        kind: "document-pdf",
        html: "<html><body><h1>Integration Test</h1><p>PDF body</p></body></html>",
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(1000);
    // PDF-magic-bytes: ASCII "%PDF-" am Anfang (0x25 0x50 0x44 0x46 0x2D)
    const bytes = new Uint8Array(buffer);
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
    expect(bytes[4]).toBe(0x2d); // -
  });

  test("kind=image-snapshot liefert valid PNG mit magic-bytes", async () => {
    const { app } = createApp(CONFIG);
    const res = await app.request("/render", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.authToken}`,
      },
      body: JSON.stringify({
        kind: "image-snapshot",
        html: "<html><body style='margin:0'><div style='width:200px;height:100px;background:red'></div></body></html>",
        options: { width: 200, height: 100, format: "png" },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // PNG-magic-bytes: 89 50 4E 47 0D 0A 1A 0A
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x4e); // N
    expect(bytes[3]).toBe(0x47); // G
  });

  test("Metrics-Counter wird nach echtem Render erhöht", async () => {
    const { app, metrics } = createApp(CONFIG);
    const initialPdfCount = metrics.rendersTotal.pdf;
    await app.request("/render", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.authToken}`,
      },
      body: JSON.stringify({ kind: "document-pdf", html: "<p>x</p>" }),
    });
    expect(metrics.rendersTotal.pdf).toBe(initialPdfCount + 1);
    expect(metrics.renderDurationMs.length).toBeGreaterThan(0);
  });
});

// Skip in CI: Chromium won't launch on cdgs-runner (#75/#253). The
// page.on("request") + abort wiring itself is covered chromium-free by
// egress-guard-wiring.test.ts → attachEgressRequestGuard; this block only
// proves end-to-end abort against a real local server.
describe.skipIf(!!process.env["CI"])("Egress-Guard (enterprise#267) im echten Render", () => {
  test("img src to loopback is aborted (requestCount stays 0); render still succeeds", async () => {
    // Loopback server: requestCount stays 0 iff the guard aborts before connect.
    // The data: URI continue-path guarantee and RFC1918/metadata CIDR blocking
    // are unit-tested in egress-guard.test.ts (isBlockedRequestUrl); the
    // page.on("request") abort wiring itself is covered chromium-free by
    // egress-guard-wiring.test.ts.
    let requestCount = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        requestCount++;
        return new Response("should never be reached");
      },
    });
    try {
      const { app } = createApp(CONFIG);
      const res = await app.request("/render", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CONFIG.authToken}`,
        },
        body: JSON.stringify({
          kind: "document-pdf",
          html: `<html><body><img src="http://127.0.0.1:${server.port}/tracking-pixel.png"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></body></html>`,
        }),
      });
      expect(res.status).toBe(200);
      expect(requestCount).toBe(0);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes[0]).toBe(0x25); // "%PDF-" magic bytes
    } finally {
      server.stop(true);
    }
  });
});

// skip: arm64 Chrome won't launch on cdgs-runner (#75/#253); opt-in via PUPPETEER_RENDER_TESTS=1
describe.skipIf(!RUN_RENDER_TESTS)("countPdfPages gegen ein ECHTES Chromium-PDF (87/1)", () => {
  test("mehrseitiger Content → countPdfPages zählt > 1 Seite", async () => {
    const { app } = createApp(CONFIG);
    // ~60 paragraphs with forced breaks reliably blow past an A4 page.
    const blocks = Array.from(
      { length: 12 },
      (_, i) => `<div style="page-break-after: always;"><h2>Block ${i}</h2></div>`,
    ).join("");
    const res = await app.request("/render", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.authToken}`,
      },
      body: JSON.stringify({ kind: "document-pdf", html: `<html><body>${blocks}</body></html>` }),
    });
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const pages = countPdfPages(bytes);
    // Bisher nur synthetische Byte-Fixtures — das hier ist der Beweis,
    // dass der Parser Chromiums echtes Objekt-Layout versteht.
    expect(pages).toBeGreaterThanOrEqual(12);
  });
});
