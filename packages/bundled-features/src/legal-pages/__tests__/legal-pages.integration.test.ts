import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type {
  TemplateResolverApi,
  TemplateResource,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import {
  createTemplateResolverApi,
  createTemplateResolverFeature,
  TEXT_BLOCK_KIND,
  TemplateNotFoundError,
  templateResourceEntity,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { seedTextBlock } from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createLegalPagesFeature, runLegalPagesBootCheck } from "../feature";
import { renderMarkdownToHtml, wrapInLayout } from "../markdown";

let stack: TestStack;
let db: DbConnection;

const textFeature = createTemplateResolverFeature();
const legalFeature = createLegalPagesFeature();

beforeAll(async () => {
  // legal-pages braucht zwei wirings:
  //   1. anonymousAccess für die /legal/*-Routes (laufen ohne JWT)
  //   2. extraContext.templateResolver damit der Boot-Check + interner
  //      Cross-Feature-Lookup ohne direct DB-Coupling funktioniert
  stack = await setupTestStack({
    features: [textFeature, legalFeature],
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
    extraContext: ({ db }) => ({
      templateResolver: createTemplateResolverApi(db),
    }),
  });
  db = stack.db;
  await unsafeCreateEntityTable(db, templateResourceEntity);
  await createEventsTable(db);

  // Seed legal blocks für SYSTEM_TENANT in DE
  await seedTextBlock(db, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "imprint",
    locale: "de",
    title: "Impressum",
    content: "## Angaben gemäß § 5 TMG\n\n**Marc Frost**\n\nSlevogtstr. 10, Leipzig",
  });
  await seedTextBlock(db, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "privacy",
    locale: "de",
    title: "Datenschutzerklärung",
    content: "## 1. Überblick\n\nWir verarbeiten **keine Tracking-Cookies**.",
  });
  await seedTextBlock(db, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "imprint",
    locale: "en",
    title: "Imprint",
    content: "## Provider\n\n**Marc Frost**\n\nLeipzig, Germany",
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
      locale: "fr",
      title: "Mentions légales",
      content: null,
    });
    // Keine /legal/imprint-fr-Route registriert (LEGAL_ROUTES ist
    // de+en) — wir adden nicht extra. Stattdessen testen wir das
    // Verhalten via direct getBlock-Lookup gegen einen leeren
    // privacy-en Block (existiert noch nicht im stack-setup).
    await seedTextBlock(db, {
      tenantId: SYSTEM_TENANT_ID,
      slug: "privacy",
      locale: "en",
      title: "Privacy Policy",
      content: null,
    });
    const res = await stack.app.request("/legal/privacy");
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain("Tenant-Admin");
  });

  test("Markdown-Body mit <script> wird escaped (XSS-Härtung)", async () => {
    // Server-Render ist gegen untrusted Tenant-Authoren gehärtet:
    // Raw-HTML im Markdown-Body wird als Text escaped (kein Passthrough).
    await seedTextBlock(db, {
      tenantId: SYSTEM_TENANT_ID,
      slug: "imprint",
      locale: "de",
      title: "Impressum",
      content: "## XSS-Test\n\n<script>window.x=1</script>\n\nDanach.",
      ifExists: "update",
    });
    const res = await stack.app.request("/legal/impressum");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("<script>window.x=1</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("legal-pages :: cache-control", () => {
  test("sets revalidate cache header + etag", async () => {
    const res = await stack.app.request("/legal/impressum");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, must-revalidate");
    expect(res.headers.get("etag")).toBeTruthy();
  });

  test("If-None-Match → 304 when content unchanged", async () => {
    const first = await stack.app.request("/legal/impressum");
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const second = await stack.app.request("/legal/impressum", {
      headers: { "if-none-match": etag ?? "" },
    });
    expect(second.status).toBe(304);
  });

  test("HEAD → 200 without body, etag present", async () => {
    const res = await stack.app.request("/legal/impressum", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(res.headers.get("etag")).toBeTruthy();
  });
});

describe("legal-pages :: security headers", () => {
  test("server-gerenderte Pages tragen CSP + Hardening-Header", async () => {
    const res = await stack.app.request("/legal/impressum");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
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
      features: [createTemplateResolverFeature(), createLegalPagesFeature()],
      anonymousAccess: {
        // Resolver gibt IMMER einen anderen Tenant zurück — wenn legal-
        // pages den respektieren würde, wäre der DB-Lookup leer.
        tenantResolver: () => otherTenantId,
        // Mirrors publicstatus's real subdomain resolver: the tenant is
        // derived from the host, which the client cannot forge — trusted
        // over any client-supplied tenant.
        resolverTrust: "authoritative",
        tenantExists: async (id) => id === otherTenantId || id === SYSTEM_TENANT_ID,
      },
      extraContext: ({ db }) => ({
        templateResolver: createTemplateResolverApi(db),
      }),
    });
    try {
      await unsafeCreateEntityTable(hostScopedStack.db, templateResourceEntity);
      await createEventsTable(hostScopedStack.db);

      // Block NUR im SYSTEM_TENANT seeden — NICHT im otherTenantId
      await seedTextBlock(hostScopedStack.db, {
        tenantId: SYSTEM_TENANT_ID,
        slug: "imprint",
        locale: "de",
        title: "System-Impressum",
        content: "## Plattform\n\nMarc Frost",
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

describe("legal-pages :: wrapLayout erhält route.slug (alt-lang-switch-regression)", () => {
  test("custom wrapLayout bekommt den passenden slug pro Route, nicht immer imprint", async () => {
    const seenSlugs: (string | undefined)[] = [];
    const customStack = await setupTestStack({
      features: [
        createTemplateResolverFeature(),
        createLegalPagesFeature({
          wrapLayout: (opts) => {
            seenSlugs.push(opts.slug);
            return `<html data-slug="${opts.slug ?? ""}">${opts.bodyHtml}</html>`;
          },
        }),
      ],
      anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
      extraContext: ({ db }) => ({
        templateResolver: createTemplateResolverApi(db),
      }),
    });
    try {
      await unsafeCreateEntityTable(customStack.db, templateResourceEntity);
      await createEventsTable(customStack.db);
      await seedTextBlock(customStack.db, {
        tenantId: SYSTEM_TENANT_ID,
        slug: "imprint",
        locale: "de",
        title: "Impressum",
        content: "Body",
      });
      await seedTextBlock(customStack.db, {
        tenantId: SYSTEM_TENANT_ID,
        slug: "privacy",
        locale: "de",
        title: "Datenschutzerklärung",
        content: "Body",
      });

      const imprintRes = await customStack.app.request("/legal/impressum");
      expect(imprintRes.status).toBe(200);
      expect(await imprintRes.text()).toContain('data-slug="imprint"');

      const privacyRes = await customStack.app.request("/legal/datenschutz");
      expect(privacyRes.status).toBe(200);
      expect(await privacyRes.text()).toContain('data-slug="privacy"');

      expect(seenSlugs).toEqual(["imprint", "privacy"]);
    } finally {
      await customStack.cleanup();
    }
  });
});

describe("legal-pages :: runLegalPagesBootCheck (direct unit-tests)", () => {
  // Direkter Test der Boot-Check-Logik mit constructed ctx-Objects —
  // keine JobRunner-Coupling, keine Test-Stacks. Das ist die echte
  // Verhalten-Test-Surface; r.job() ist nur thin shell darum.

  type Block = { slug: string; lang: string; title: string; content: string | null };

  function fakeTemplateResolver(blocks: readonly Block[]): {
    api: TemplateResolverApi;
    calls: { tenantId: string; slug: string; lang: string }[];
  } {
    const calls: { tenantId: string; slug: string; lang: string }[] = [];
    const find = (slug: string, locale: string): TemplateResource | null => {
      const block = blocks.find((b) => b.slug === slug && b.lang === locale);
      if (!block) return null;
      return {
        id: `${block.slug}-${block.lang}`,
        version: 1,
        tenantId: SYSTEM_TENANT_ID,
        slug: block.slug,
        kind: TEXT_BLOCK_KIND,
        locale: block.lang,
        title: block.title,
        folder: null,
        content: block.content ?? "",
        contentFormat: "markdown",
        variableSchema: {},
        linkedResources: {},
        scope: "system",
        parentTemplateId: null,
        status: "active",
        updatedAt: new Date(),
      };
    };
    return {
      calls,
      api: {
        findExact: async ({ tenantId, slug, locale }) => {
          calls.push({ tenantId, slug, lang: locale });
          return find(slug, locale);
        },
        resolveTemplate: async ({ slug, kind, locale }) => {
          const found = find(slug, locale);
          if (!found) throw new TemplateNotFoundError({ slug, kind, locale });
          return found;
        },
      },
    };
  }

  test("alle Pflicht-Blocks vorhanden → log.info, kein throw", async () => {
    const { api } = fakeTemplateResolver([
      { slug: "imprint", lang: "de", title: "I", content: "body" },
      { slug: "privacy", lang: "de", title: "P", content: "body" },
    ]);
    const infos: string[] = [];
    const warns: string[] = [];
    await expect(
      runLegalPagesBootCheck({
        templateResolver: api,
        log: { info: (m) => infos.push(m), warn: (m) => warns.push(m) },
      }),
    ).resolves.toBeUndefined();
    expect(infos).toHaveLength(1);
    expect(infos[0]).toContain("alle Pflicht-Blocks vorhanden");
    expect(warns).toHaveLength(0);
  });

  test("missing blocks + NODE_ENV=production → throws mit slug-Liste", async () => {
    const { api } = fakeTemplateResolver([]);
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      await expect(runLegalPagesBootCheck({ templateResolver: api })).rejects.toThrow(
        /Boot-Validation failed.*imprint\/de.*privacy\/de/s,
      );
    } finally {
      if (originalEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = originalEnv;
    }
  });

  test("missing blocks + NODE_ENV!=production → log.warn, kein throw", async () => {
    const { api } = fakeTemplateResolver([]);
    const warns: string[] = [];
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "development";
    try {
      await expect(
        runLegalPagesBootCheck({
          templateResolver: api,
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

  test("ctx ohne templateResolver → InternalError mit Wiring-Hinweis", async () => {
    await expect(runLegalPagesBootCheck({})).rejects.toThrow(
      /templateResolver missing.*extraContext/s,
    );
  });

  test("Block existiert aber content ist null → wird als missing gezählt", async () => {
    const { api } = fakeTemplateResolver([
      { slug: "imprint", lang: "de", title: "I", content: null },
      { slug: "privacy", lang: "de", title: "P", content: "body" },
    ]);
    const warns: string[] = [];
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "development";
    try {
      await runLegalPagesBootCheck({
        templateResolver: api,
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
    const { api, calls } = fakeTemplateResolver([
      { slug: "imprint", lang: "de", title: "I", content: "x" },
      { slug: "privacy", lang: "de", title: "P", content: "x" },
    ]);
    await runLegalPagesBootCheck({ templateResolver: api });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.tenantId).toBe(SYSTEM_TENANT_ID);
    }
  });
});
