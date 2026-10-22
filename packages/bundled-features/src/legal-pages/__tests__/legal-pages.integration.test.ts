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
import { createRegistry, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { withEnv } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createLegalPagesFeature, runLegalPagesBootCheck } from "../feature.ts";
import { renderMarkdownToHtml, wrapInLayout } from "../markdown.ts";

let stack: TestStack;
let db: DbConnection;

const textFeature = createTemplateResolverFeature();
const legalFeature = createLegalPagesFeature();

beforeAll(async () => {
  // legal-pages requires two wirings:
  //   1. anonymousAccess for the /legal/* routes (which run without JWT)
  //   2. extraContext.templateResolver so the boot check and internal
  //      cross-feature lookup work without direct DB coupling
  stack = await setupTestStack({
    features: [textFeature, legalFeature],
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
    extraContext: ({ db, registry }) => ({
      templateResolver: createTemplateResolverApi(db, registry),
    }),
  });
  db = stack.db;
  await unsafeCreateEntityTable(db, templateResourceEntity);

  // Seed legal blocks for SYSTEM_TENANT in DE
  await seedTextBlock(db, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "imprint",
    locale: "de",
    title: "Impressum",
    content: "## Angaben gemäß § 5 TMG\n\n**Alex Morgan**\n\nMusterstraße 1, Musterstadt",
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
    content: "## Provider\n\n**Alex Morgan**\n\nMusterstadt, Germany",
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
    expect(body).toContain("Alex Morgan");
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
    expect(body).toContain("Musterstadt");
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
    // seedTextBlock permits body=null as a legitimate stub state.
    // Routes must treat this as "not configured", NOT as a valid empty page
    // (which would falsely present a GDPR-required page as existing).
    await seedTextBlock(db, {
      tenantId: SYSTEM_TENANT_ID,
      slug: "imprint",
      locale: "fr",
      title: "Mentions légales",
      content: null,
    });
    // No /legal/imprint-fr route is registered (LEGAL_ROUTES contains
    // de+en), so we do not add one just for this test. Instead, test the
    // behavior through a direct getBlock lookup against an empty
    // privacy-en block (which does not yet exist in the stack setup).
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
    // Server rendering is hardened against untrusted tenant authors:
    // Raw HTML in the Markdown body is escaped as text (not passed through).
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

  test("etag changes once the block was edited", async () => {
    const before = (await stack.app.request("/legal/datenschutz")).headers.get("etag");
    await seedTextBlock(db, {
      tenantId: SYSTEM_TENANT_ID,
      slug: "privacy",
      locale: "de",
      title: "Datenschutzerklärung",
      content: "**Tracking-Cookies** neu gefasst",
      ifExists: "update",
    });
    const after = (await stack.app.request("/legal/datenschutz")).headers.get("etag");
    expect(before).toBeTruthy();
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
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

describe("legal-pages :: boot gate wiring", () => {
  // The abort behaviour itself is proven in the framework's job-runner
  // integration tests ("boot gates"); this only pins that legal-pages is
  // wired onto that path and not onto the fire-and-forget runOnBoot one.
  test("boot check is declared as a bootGate, not as runOnBoot", () => {
    const registry = createRegistry([textFeature, legalFeature]);
    const job = registry.getJob("legal-pages:job:legal-pages-boot-check");
    expect(job).toBeDefined();
    expect(job?.bootGate).toBe(true);
    expect(job?.runOnBoot).toBeUndefined();
  });
});

// Boot check called directly (without the dev-server job-runner path) —
// verifies that the logic detects blocks missing in SYSTEM_TENANT.
describe("legal-pages :: SYSTEM_TENANT-routing (production-bug-regression)", () => {
  test("legal-pages serven SYSTEM_TENANT-Texte auch wenn tenantResolver einen anderen Tenant zurückgibt", async () => {
    // Simulates publicstatus's setup: a host-based tenantResolver resolves
    // the tenant subdomain to a tenant ID. Without the X-Tenant fix,
    // /legal/impressum for tenant-x.example.com would query tenant-x's
    // empty imprint block and return 404. With the fix, it always uses SYSTEM_TENANT.
    const otherTenantId = "22222222-2222-4222-8222-222222222222";
    const hostScopedStack = await setupTestStack({
      features: [createTemplateResolverFeature(), createLegalPagesFeature()],
      anonymousAccess: {
        // The resolver always returns another tenant—if legal-pages respected it,
        // the database lookup would be empty.
        tenantResolver: () => otherTenantId,
        // Mirrors publicstatus's real subdomain resolver: the tenant is
        // derived from the host, which the client cannot forge — trusted
        // over any client-supplied tenant.
        resolverTrust: "authoritative",
        tenantExists: async (id) => id === otherTenantId || id === SYSTEM_TENANT_ID,
      },
      extraContext: ({ db, registry }) => ({
        templateResolver: createTemplateResolverApi(db, registry),
      }),
    });
    try {
      await unsafeCreateEntityTable(hostScopedStack.db, templateResourceEntity);

      // Seed the block only in SYSTEM_TENANT — not in otherTenantId
      await seedTextBlock(hostScopedStack.db, {
        tenantId: SYSTEM_TENANT_ID,
        slug: "imprint",
        locale: "de",
        title: "System-Impressum",
        content: "## Plattform\n\nAlex Morgan",
      });

      const res = await hostScopedStack.app.request("/legal/impressum");
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("System-Impressum");
      expect(body).toContain("Alex Morgan");
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
      extraContext: ({ db, registry }) => ({
        templateResolver: createTemplateResolverApi(db, registry),
      }),
    });
    try {
      await unsafeCreateEntityTable(customStack.db, templateResourceEntity);
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

describe("legal-pages :: configurable routes/requiredBlocks (non-DACH apps)", () => {
  test("custom route (es) serves the seeded Spanish text-block", async () => {
    const esStack = await setupTestStack({
      features: [
        createTemplateResolverFeature(),
        createLegalPagesFeature({
          routes: [
            {
              path: "/legal/aviso-legal",
              slug: "imprint",
              lang: "es",
              titleFallback: "Aviso legal",
            },
          ],
          requiredBlocks: [{ slug: "imprint", lang: "es" }],
        }),
      ],
      anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
      extraContext: ({ db, registry }) => ({
        templateResolver: createTemplateResolverApi(db, registry),
      }),
    });
    try {
      await unsafeCreateEntityTable(esStack.db, templateResourceEntity);
      await seedTextBlock(esStack.db, {
        tenantId: SYSTEM_TENANT_ID,
        slug: "imprint",
        locale: "es",
        title: "Aviso legal",
        content: "## Datos del titular\n\n**Alex Morgan**",
      });

      const res = await esStack.app.request("/legal/aviso-legal");
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('lang="es"');
      expect(body).toContain("<title>Aviso legal</title>");
      expect(body).toContain("Datos del titular");

      // Default DACH routes are gone once `routes` is overridden.
      const dachRes = await esStack.app.request("/legal/impressum");
      expect(dachRes.status).toBe(404);
    } finally {
      await esStack.cleanup();
    }
  });

  test("titleHeading prepends an escaped <h1> with the title; default leaves the body unchanged", async () => {
    const headingStack = await setupTestStack({
      features: [
        createTemplateResolverFeature(),
        createLegalPagesFeature({
          routes: [
            {
              path: "/legal/with-heading",
              slug: "terms",
              lang: "en",
              titleFallback: "Terms",
              titleHeading: true,
            },
            { path: "/legal/without-heading", slug: "terms", lang: "en", titleFallback: "Terms" },
          ],
          requiredBlocks: [],
        }),
      ],
      anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
      extraContext: ({ db, registry }) => ({
        templateResolver: createTemplateResolverApi(db, registry),
      }),
    });
    try {
      await unsafeCreateEntityTable(headingStack.db, templateResourceEntity);
      await seedTextBlock(headingStack.db, {
        tenantId: SYSTEM_TENANT_ID,
        slug: "terms",
        locale: "en",
        title: "Terms <b>& Conditions</b>",
        content: "Body text",
      });

      const withHeading = await (await headingStack.app.request("/legal/with-heading")).text();
      expect(withHeading).toContain(
        "<h1>Terms &lt;b&gt;&amp; Conditions&lt;/b&gt;</h1><p>Body text</p>",
      );

      const withoutHeading = await (
        await headingStack.app.request("/legal/without-heading")
      ).text();
      expect(withoutHeading).not.toContain("<h1>");
      expect(withoutHeading).toContain("<p>Body text</p>");
    } finally {
      await headingStack.cleanup();
    }
  });

  test("createLegalPagesFeature throws on duplicate route path", () => {
    expect(() =>
      createLegalPagesFeature({
        routes: [
          { path: "/legal/aviso-legal", slug: "imprint", lang: "es", titleFallback: "Aviso" },
          { path: "/legal/aviso-legal", slug: "privacy", lang: "es", titleFallback: "Privacidad" },
        ],
      }),
    ).toThrow(/duplicate route path/);
  });

  test("createLegalPagesFeature throws on empty path/slug/lang", () => {
    expect(() =>
      createLegalPagesFeature({
        routes: [{ path: "", slug: "imprint", lang: "es", titleFallback: "Aviso" }],
      }),
    ).toThrow(/missing a required field/);
  });

  test("createLegalPagesFeature throws when path doesn't start with /", () => {
    expect(() =>
      createLegalPagesFeature({
        routes: [
          { path: "legal/aviso-legal", slug: "imprint", lang: "es", titleFallback: "Aviso" },
        ],
      }),
    ).toThrow(/must start with/);
  });

  test("createLegalPagesFeature throws when custom routes cover no default required block and requiredBlocks is omitted", () => {
    const esRoutes = [
      { path: "/legal/aviso-legal", slug: "imprint", lang: "es", titleFallback: "Aviso" },
    ];
    expect(() => createLegalPagesFeature({ routes: esRoutes })).toThrow(/without `requiredBlocks`/);
    expect(() =>
      createLegalPagesFeature({
        routes: esRoutes,
        requiredBlocks: [{ slug: "imprint", lang: "es" }],
      }),
    ).not.toThrow();
  });

  test("empty routes array is allowed (boot-check only, no public routes)", () => {
    expect(() => createLegalPagesFeature({ routes: [] })).not.toThrow();
  });
});

describe("legal-pages :: runLegalPagesBootCheck (direct unit-tests)", () => {
  // Directly tests the boot-check logic with constructed context objects—
  // without JobRunner coupling or test stacks. This is the actual behavior
  // test surface; r.job() is only a thin shell around it.

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
        meta: null,
        scope: "system",
        parentTemplateId: null,
        status: "active",
        modifiedAt: null,
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
        resolveLayout: async ({ slug, kind, locale }) => {
          throw new TemplateNotFoundError({ slug, kind, locale });
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
    await withEnv({ NODE_ENV: "production" }, async () => {
      await expect(runLegalPagesBootCheck({ templateResolver: api })).rejects.toThrow(
        /Boot-Validation failed.*imprint\/de.*privacy\/de/s,
      );
    });
  });

  test("missing blocks + NODE_ENV!=production → log.warn, kein throw", async () => {
    const { api } = fakeTemplateResolver([]);
    const warns: string[] = [];
    await withEnv({ NODE_ENV: "development" }, async () => {
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
    });
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
    await withEnv({ NODE_ENV: "development" }, async () => {
      await runLegalPagesBootCheck({
        templateResolver: api,
        log: { warn: (m) => warns.push(m) },
      });
      expect(warns[0]).toContain("missing 1 required text-block(s)");
      expect(warns[0]).toContain("imprint/de");
      expect(warns[0]).not.toContain("privacy/de");
    });
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

  test("custom requiredBlock (es privacy) fehlt → throws in production", async () => {
    const { api } = fakeTemplateResolver([
      { slug: "imprint", lang: "es", title: "I", content: "x" },
    ]);
    await withEnv({ NODE_ENV: "production" }, async () => {
      await expect(
        runLegalPagesBootCheck({ templateResolver: api }, [
          { slug: "imprint", lang: "es" },
          { slug: "privacy", lang: "es" },
        ]),
      ).rejects.toThrow(/Boot-Validation failed.*privacy\/es/s);
    });
  });

  test("custom requiredBlock (es privacy) vorhanden → kein throw", async () => {
    const { api } = fakeTemplateResolver([
      { slug: "imprint", lang: "es", title: "I", content: "x" },
      { slug: "privacy", lang: "es", title: "P", content: "x" },
    ]);
    await withEnv({ NODE_ENV: "production" }, async () => {
      await expect(
        runLegalPagesBootCheck({ templateResolver: api }, [
          { slug: "imprint", lang: "es" },
          { slug: "privacy", lang: "es" },
        ]),
      ).resolves.toBeUndefined();
    });
  });

  test("createLegalPagesFeature threads requiredBlocks into the boot-check job, not the DACH default", async () => {
    // Goes through the actual job registered by createLegalPagesFeature
    // (not a direct runLegalPagesBootCheck call, unlike the tests above) —
    // proves the `requiredBlocks` option reaches the job closure. DE blocks
    // are seeded but the feature is built with an es-only requiredBlocks
    // list: if the job still checked the hardcoded LEGAL_REQUIRED_BLOCKS
    // (DE), this would resolve instead of rejecting on the missing es block.
    const { api } = fakeTemplateResolver([
      { slug: "imprint", lang: "de", title: "I", content: "x" },
      { slug: "privacy", lang: "de", title: "P", content: "x" },
    ]);
    const feature = createLegalPagesFeature({
      requiredBlocks: [{ slug: "privacy", lang: "es" }],
    });
    const job = feature.jobs["legal-pages-boot-check"];
    if (!job) throw new Error("legal-pages-boot-check job not registered");
    // @cast-boundary test-only — job.handler is typed against the full
    // JobContext; runLegalPagesBootCheck only reads templateResolver off it.
    const handler = job.handler as unknown as (
      payload: Record<string, unknown>,
      ctx: { templateResolver: TemplateResolverApi },
    ) => Promise<void>;
    await withEnv({ NODE_ENV: "production" }, async () => {
      await expect(handler({}, { templateResolver: api })).rejects.toThrow(/privacy\/es/);
    });
  });
});

describe("legal-pages :: trailing-slash redirect", () => {
  test("the slash form of a route redirects GET and HEAD with 301, query string kept", async () => {
    for (const method of ["GET", "HEAD"]) {
      const res = await stack.app.request("/legal/impressum/?utm=1", { method });
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("/legal/impressum?utm=1");
    }
  });

  test("a path configured with a trailing slash is the target for the form without it", async () => {
    const slashStack = await setupTestStack({
      features: [
        createTemplateResolverFeature(),
        createLegalPagesFeature({
          routes: [{ path: "/legal/terms/", slug: "imprint", lang: "de", titleFallback: "Terms" }],
        }),
      ],
      anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
      extraContext: ({ db, registry }) => ({
        templateResolver: createTemplateResolverApi(db, registry),
      }),
    });
    try {
      await unsafeCreateEntityTable(slashStack.db, templateResourceEntity);
      const res = await slashStack.app.request("/legal/terms?a=b");
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("/legal/terms/?a=b");
    } finally {
      await slashStack.cleanup();
    }
  });
});
