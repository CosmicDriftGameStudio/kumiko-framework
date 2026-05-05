import type { TextContentApi } from "@cosmicdrift/kumiko-bundled-features/text-content";
import {
  createTextContentApi,
  createTextContentFeature,
  textBlockEntity,
} from "@cosmicdrift/kumiko-bundled-features/text-content";
import { seedTextBlock } from "@cosmicdrift/kumiko-bundled-features/text-content/seeding";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createEntityTable, setupTestStack, type TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createLegalPagesFeature, runLegalPagesBootCheck } from "../feature";
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

describe("legal-pages :: edge-cases", () => {
  test("Block existiert mit body=null → Route returnt 404 statt leerer HTML", async () => {
    // seedTextBlock erlaubt body=null als legitimer Stub-State.
    // Routes sollen das als "not configured" behandeln, NICHT als
    // valides leeres Page rendern (würde DSGVO-pflichtige Page als
    // existent vortäuschen).
    await seedTextBlock(db, {
      tenantId: SYSTEM_TENANT_ID,
      slug: "imprint",
      lang: "fr",
      title: "Mentions légales",
      body: null,
    });
    // Keine /legal/imprint-fr-Route registriert (LEGAL_ROUTES ist
    // de+en) — wir adden nicht extra. Stattdessen testen wir das
    // Verhalten via direct getBlock-Lookup gegen einen leeren
    // privacy-en Block (existiert noch nicht im stack-setup).
    await seedTextBlock(db, {
      tenantId: SYSTEM_TENANT_ID,
      slug: "privacy",
      lang: "en",
      title: "Privacy Policy",
      body: null,
    });
    const res = await stack.app.request("/legal/privacy");
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain("Tenant-Admin");
  });

  test("Markdown-Body mit <script> wird NICHT escaped (dokumentiertes XSS-Verhalten, siehe README)", async () => {
    // Bewusstes Verhalten: marked.parse rendered HTML 1:1, kein
    // DOMPurify-Layer aktuell. Dokumentiert in legal-pages/README.md
    // ('XSS — bewusst aktuell nicht gesichert'). Test pinnt das
    // Verhalten — wenn es sich ändert (z.B. DOMPurify dazu), schlägt
    // dieser Test fehl und der Wechsel ist dokumentiert.
    await seedTextBlock(db, {
      tenantId: SYSTEM_TENANT_ID,
      slug: "imprint",
      lang: "de",
      title: "Impressum",
      body: "## XSS-Test\n\n<script>window.x=1</script>\n\nDanach.",
    });
    const res = await stack.app.request("/legal/impressum");
    expect(res.status).toBe(200);
    const html = await res.text();
    // Aktuelles Verhalten: script-tag bleibt unescaped im Output
    expect(html).toContain("<script>window.x=1</script>");
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
describe("legal-pages :: SYSTEM_TENANT-routing (production-bug-regression)", () => {
  test("legal-pages serven SYSTEM_TENANT-Texte auch wenn tenantResolver einen anderen Tenant zurückgibt", async () => {
    // Simuliert publicstatus's Setup: host-basierter tenantResolver der
    // tenant-subdomain → tenant-tenantId resolved. Ohne den X-Tenant-Fix
    // würde /legal/impressum für tenant-x.example.com tenant-x's
    // (leeren) imprint-Block abfragen → 404. Mit Fix immer SYSTEM_TENANT.
    const otherTenantId = "22222222-2222-4222-8222-222222222222";
    const hostScopedStack = await setupTestStack({
      features: [createTextContentFeature(), createLegalPagesFeature()],
      anonymousAccess: {
        // Resolver gibt IMMER einen anderen Tenant zurück — wenn legal-
        // pages den respektieren würde, wäre der DB-Lookup leer.
        tenantResolver: () => otherTenantId,
        tenantExists: async (id) => id === otherTenantId || id === SYSTEM_TENANT_ID,
      },
      extraContext: ({ db }) => ({
        textContent: createTextContentApi(db),
      }),
    });
    try {
      await createEntityTable(hostScopedStack.db, textBlockEntity);
      await createEventsTable(hostScopedStack.db);

      // Block NUR im SYSTEM_TENANT seeden — NICHT im otherTenantId
      await seedTextBlock(hostScopedStack.db, {
        tenantId: SYSTEM_TENANT_ID,
        slug: "imprint",
        lang: "de",
        title: "System-Impressum",
        body: "## Plattform\n\nMarc Frost",
      });

      const res = await hostScopedStack.app.request("/legal/impressum");
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("System-Impressum");
      expect(body).toContain("Marc Frost");
    } finally {
      await hostScopedStack.cleanup();
    }
  });
});

describe("legal-pages :: runLegalPagesBootCheck (direct unit-tests)", () => {
  // Direkter Test der Boot-Check-Logik mit constructed ctx-Objects —
  // keine JobRunner-Coupling, keine Test-Stacks. Das ist die echte
  // Verhalten-Test-Surface; r.job() ist nur thin shell darum.

  type Block = { slug: string; lang: string; title: string; body: string | null };

  function fakeTextContent(blocks: readonly Block[]): {
    api: TextContentApi;
    calls: { tenantId: string; slug: string; lang: string }[];
  } {
    const calls: { tenantId: string; slug: string; lang: string }[] = [];
    return {
      calls,
      api: {
        getBlock: async ({ tenantId, slug, lang }) => {
          calls.push({ tenantId, slug, lang });
          const block = blocks.find((b) => b.slug === slug && b.lang === lang);
          if (!block) return null;
          return { ...block, updatedAt: new Date() };
        },
      },
    };
  }

  test("alle Pflicht-Blocks vorhanden → log.info, kein throw", async () => {
    const { api } = fakeTextContent([
      { slug: "imprint", lang: "de", title: "I", body: "body" },
      { slug: "privacy", lang: "de", title: "P", body: "body" },
    ]);
    const infos: string[] = [];
    const warns: string[] = [];
    await expect(
      runLegalPagesBootCheck({
        textContent: api,
        log: { info: (m) => infos.push(m), warn: (m) => warns.push(m) },
      }),
    ).resolves.toBeUndefined();
    expect(infos).toHaveLength(1);
    expect(infos[0]).toContain("alle Pflicht-Blocks vorhanden");
    expect(warns).toHaveLength(0);
  });

  test("missing blocks + NODE_ENV=production → throws mit slug-Liste", async () => {
    const { api } = fakeTextContent([]);
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      await expect(runLegalPagesBootCheck({ textContent: api })).rejects.toThrow(
        /Boot-Validation failed.*imprint\/de.*privacy\/de/s,
      );
    } finally {
      if (originalEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = originalEnv;
    }
  });

  test("missing blocks + NODE_ENV!=production → log.warn, kein throw", async () => {
    const { api } = fakeTextContent([]);
    const warns: string[] = [];
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "development";
    try {
      await expect(
        runLegalPagesBootCheck({
          textContent: api,
          log: { warn: (m) => warns.push(m) },
        }),
      ).resolves.toBeUndefined();
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("missing 2 required text-block(s)");
      expect(warns[0]).toContain("imprint/de");
      expect(warns[0]).toContain("privacy/de");
    } finally {
      if (originalEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = originalEnv;
    }
  });

  test("ctx ohne textContent → InternalError mit Wiring-Hinweis", async () => {
    await expect(runLegalPagesBootCheck({})).rejects.toThrow(/textContent missing.*extraContext/s);
  });

  test("Block existiert aber body ist null → wird als missing gezählt", async () => {
    const { api } = fakeTextContent([
      { slug: "imprint", lang: "de", title: "I", body: null },
      { slug: "privacy", lang: "de", title: "P", body: "body" },
    ]);
    const warns: string[] = [];
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "development";
    try {
      await runLegalPagesBootCheck({
        textContent: api,
        log: { warn: (m) => warns.push(m) },
      });
      expect(warns[0]).toContain("missing 1 required text-block(s)");
      expect(warns[0]).toContain("imprint/de");
      expect(warns[0]).not.toContain("privacy/de");
    } finally {
      if (originalEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = originalEnv;
    }
  });

  test("alle Lookups erfolgen gegen SYSTEM_TENANT_ID (nie tenant-scoped)", async () => {
    const { api, calls } = fakeTextContent([
      { slug: "imprint", lang: "de", title: "I", body: "x" },
      { slug: "privacy", lang: "de", title: "P", body: "x" },
    ]);
    await runLegalPagesBootCheck({ textContent: api });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.tenantId).toBe(SYSTEM_TENANT_ID);
    }
  });
});
