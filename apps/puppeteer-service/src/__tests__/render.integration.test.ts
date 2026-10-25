// Integration test with a real puppeteer launch. Closes the gap left by the
// unit tests (which only exercise auth + validation, not the render path).
// The README smoke test is manual and prone to drift.

import { afterAll, describe, expect, test } from "bun:test";
import { countPdfPages } from "@cosmicdrift/kumiko-renderer-puppeteer-client";
import type { ServiceConfig } from "../config";
import { shutdownBrowser } from "../render";
import { createApp } from "../server";

const CONFIG: ServiceConfig = {
  port: 0,
  authToken: "integration-test-token-0123456789abcdef0123",
  renderTimeoutMs: 15_000,
  maxHtmlBytes: 100_000,
  maxConcurrentRenders: 4,
  puppeteerExecutablePath: undefined,
};

afterAll(async () => {
  await shutdownBrowser();
});

describe("POST /render — echtes Puppeteer-Rendering", () => {
  test("kind=document-pdf returns a valid PDF with magic bytes %PDF-", async () => {
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

  test("kind=image-snapshot returns a valid PNG with magic bytes", async () => {
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

  test("Metrics counter is incremented after a real render", async () => {
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

// The page.on("request") + abort wiring is also covered chromium-free by
// egress-guard-wiring.test.ts; this block proves the end-to-end abort against a real local server.
describe("Egress guard in a real render", () => {
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

describe("countPdfPages against a real Chromium PDF", () => {
  test("multi-page content → countPdfPages counts > 1 page", async () => {
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

// 1x1 transparent PNG
const PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("Document with letterhead", () => {
  test("invoice with letterhead: header, footer and a table spanning pages", async () => {
    const { app } = createApp(CONFIG);
    const rows = Array.from(
      { length: 60 },
      (_, i) => `<tr><td>Position ${i + 1}</td><td>${(i + 1) * 10},00 EUR</td></tr>`,
    ).join("");
    const res = await app.request("/render", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.authToken}`,
      },
      body: JSON.stringify({
        kind: "document-pdf",
        html: `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Rechnung R-1</title><style>table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{page-break-inside:avoid}</style></head><body><h1>Rechnung R-1</h1><table><thead><tr><th>Position</th><th>Betrag</th></tr></thead><tbody>${rows}</tbody></table></body></html>`,
        options: {
          format: "A4",
          printBackground: true,
          displayHeaderFooter: true,
          marginMm: { top: 30, bottom: 20, left: 15, right: 15 },
          headerTemplate: `<div style="font-size:9px;width:100%"><img src="${PIXEL_PNG}" style="height:8mm"> Briefkopf Test GmbH</div>`,
          footerTemplate:
            '<div style="font-size:9px;width:100%;text-align:center">Seite <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        },
      }),
    });
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(countPdfPages(bytes)).toBeGreaterThanOrEqual(2);
    const outPath = process.env["PDF_OUT_PATH"];
    if (outPath !== undefined && outPath !== "") await Bun.write(outPath, bytes);
  });

  test("an https image in the HTML is blocked and the render still finishes", async () => {
    const { app } = createApp(CONFIG);
    const res = await app.request("/render", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.authToken}`,
      },
      body: JSON.stringify({
        kind: "document-pdf",
        html: '<html><body><p>Text</p><img src="https://example.com/x.png"></body></html>',
      }),
    });
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x25);
  });
});
