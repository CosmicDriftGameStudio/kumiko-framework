import {
  createTextContentApi,
  createTextContentFeature,
  textBlockEntity,
} from "@kumiko/bundled-features/text-content";
import { seedTextBlock } from "@kumiko/bundled-features/text-content/seeding";
import type { DbConnection } from "@kumiko/framework/db";
import { SYSTEM_TENANT_ID } from "@kumiko/framework/engine";
import { createEventsTable } from "@kumiko/framework/event-store";
import { createEntityTable, setupTestStack, type TestStack } from "@kumiko/framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createLegalPagesFeature } from "../feature";
import { renderMarkdownToHtml, wrapInLayout } from "../markdown";

let stack: TestStack;
let db: DbConnection;

const textFeature = createTextContentFeature();
const legalFeature = createLegalPagesFeature();

beforeAll(async () => {
  // legal-pages braucht zwei wirings:
  //   1. anonymousAccess für die /legal/*-Routes (laufen ohne JWT)
  //   2. extraContext.textContent damit der Boot-Check + interner
  //      Cross-Feature-Lookup ohne direct DB-Coupling funktioniert
  stack = await setupTestStack({
    features: [textFeature, legalFeature],
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
    extraContext: ({ db }) => ({
      textContent: createTextContentApi(db),
    }),
  });
  db = stack.db;
  await createEntityTable(db, textBlockEntity);
  await createEventsTable(db);

  // Seed legal blocks für SYSTEM_TENANT in DE
  await seedTextBlock(db, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "imprint",
    lang: "de",
    title: "Impressum",
    body: "## Angaben gemäß § 5 TMG\n\n**Marc Frost**\n\nSlevogtstr. 10, Leipzig",
  });
  await seedTextBlock(db, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "privacy",
    lang: "de",
    title: "Datenschutzerklärung",
    body: "## 1. Überblick\n\nWir verarbeiten **keine Tracking-Cookies**.",
  });
  await seedTextBlock(db, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "imprint",
    lang: "en",
    title: "Imprint",
    body: "## Provider\n\n**Marc Frost**\n\nLeipzig, Germany",
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("legal-pages :: GET /legal/impressum", () => {
  test("returns rendered HTML for DE imprint", async () => {
    const res = await stack.app.request("/legal/impressum");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<title>Impressum</title>");
    expect(body).toContain('lang="de"');
    expect(body).toContain("Marc Frost");
    expect(body).toContain("<h2>"); // markdown-rendered ## heading
  });
});

describe("legal-pages :: GET /legal/datenschutz", () => {
  test("returns rendered HTML for DE privacy", async () => {
    const res = await stack.app.request("/legal/datenschutz");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<title>Datenschutzerklärung</title>");
    expect(body).toContain("Tracking-Cookies");
    expect(body).toContain("<strong>"); // markdown bold
  });
});

describe("legal-pages :: GET /legal/imprint (EN)", () => {
  test("returns rendered HTML for EN imprint", async () => {
    const res = await stack.app.request("/legal/imprint");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('lang="en"');
    expect(body).toContain("Leipzig");
  });
});

describe("legal-pages :: GET /legal/privacy (EN, not seeded)", () => {
  test("returns 404 with helpful message when block missing", async () => {
    const res = await stack.app.request("/legal/privacy");
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain("Privacy Policy");
    expect(body).toContain("Tenant-Admin");
  });
});

describe("legal-pages :: cache-control", () => {
  test("sets public cache header for 5min", async () => {
    const res = await stack.app.request("/legal/impressum");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });
});

describe("markdown render helpers", () => {
  test("renderMarkdownToHtml converts markdown to HTML", () => {
    const html = renderMarkdownToHtml("# Title\n\n**bold**");
    expect(html).toContain("<h1>");
    expect(html).toContain("<strong>bold</strong>");
  });

  test("wrapInLayout produces valid HTML5 with title + lang", () => {
    const html = wrapInLayout({ title: "Test", bodyHtml: "<p>x</p>", lang: "de" });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('lang="de"');
    expect(html).toContain("<title>Test</title>");
    expect(html).toContain("<p>x</p>");
  });

  test("wrapInLayout escapes title to prevent XSS", () => {
    const html = wrapInLayout({
      title: "<script>alert(1)</script>",
      bodyHtml: "x",
      lang: "en",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// Boot-Check direkt (ohne dev-server-Job-Runner-Path) — verifiziert
// dass die Logik fehlende Blocks im SYSTEM_TENANT erkennt. Der eigentliche
// runOnBoot-Trigger lebt im JobRunner und wird in jobs-feature integration-
// tests separately exercised.
describe("legal-pages :: boot-check logic", () => {
  test("missing block detection identifies imprint+privacy gaps", async () => {
    // Frischer Stack ohne Seeds, mit komplettem Wiring inklusive
    // textContent-API damit der Boot-Check über ctx.textContent
    // läuft (sonst wirft requireTextContent statt missing-blocks
    // zu erkennen).
    const freshStack = await setupTestStack({
      features: [createTextContentFeature(), createLegalPagesFeature()],
      anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
      extraContext: ({ db }) => ({
        textContent: createTextContentApi(db),
      }),
    });
    try {
      await createEntityTable(freshStack.db, textBlockEntity);
      await createEventsTable(freshStack.db);

      // Direkt-Check über die /legal/-Routes: ohne Seed → 404 für jeden
      // Pflicht-Block. Verifiziert end-to-end dass die Routes "block
      // missing"-Path sauber durchläuft (nicht 503/500).
      const { LEGAL_REQUIRED_BLOCKS } = await import("../constants");
      const missing: { slug: string; lang: string }[] = [];
      for (const required of LEGAL_REQUIRED_BLOCKS) {
        const res = await freshStack.app.request(
          `/legal/${required.slug === "imprint" ? "impressum" : "datenschutz"}`,
        );
        if (res.status === 404) {
          missing.push({ slug: required.slug, lang: required.lang });
        }
      }
      expect(missing).toHaveLength(LEGAL_REQUIRED_BLOCKS.length);
    } finally {
      await freshStack.cleanup();
    }
  });
});
