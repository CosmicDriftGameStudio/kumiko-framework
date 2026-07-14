import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createLegalPagesFeature } from "@cosmicdrift/kumiko-bundled-features/legal-pages";
import {
  createManagedPagesFeature,
  pageEntity,
} from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import { seedPage } from "@cosmicdrift/kumiko-bundled-features/managed-pages/seeding";
import {
  createTextContentApi,
  createTextContentFeature,
  textBlockEntity,
} from "@cosmicdrift/kumiko-bundled-features/text-content";
import { seedTextBlock } from "@cosmicdrift/kumiko-bundled-features/text-content/seeding";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { SEO_CONFIG_QN } from "../constants";
import { createSeoFeature, runSeoBootCheck } from "../feature";

const TENANT_A = "11111111-1111-4111-8111-111111111111";

let stack: TestStack;

const seo = createSeoFeature({
  sitemapEntries: (host) => [{ loc: `https://${host}/`, changefreq: "daily" }],
  includeLegalPages: true,
  managedPages: {
    resolveApexTenant: (host) => (host.startsWith("a.") ? TENANT_A : null),
  },
});
const managed = createManagedPagesFeature({
  resolveApexTenant: (host) => (host.startsWith("a.") ? TENANT_A : null),
});
const legal = createLegalPagesFeature();
const configFeature = createConfigFeature();
const textContent = createTextContentFeature();

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [configFeature, textContent, managed, legal, seo],
    anonymousAccess: {
      tenantExists: async (id) => id === TENANT_A || id === SYSTEM_TENANT_ID,
    },
    extraContext: ({ registry, db }) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      textContent: createTextContentApi(db),
    }),
  });
  await unsafeCreateEntityTable(stack.db, pageEntity);
  await unsafeCreateEntityTable(stack.db, textBlockEntity);
  await unsafePushTables(stack.db, { configValuesTable });
  await createEventsTable(stack.db);

  await seedTextBlock(stack.db, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "imprint",
    lang: "de",
    title: "Impressum",
    body: "## Test\n\nAcme",
  });
  await seedTextBlock(stack.db, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "privacy",
    lang: "de",
    title: "Datenschutz",
    body: "## Test\n\nAcme",
  });

  await seedPage(stack.db, {
    tenantId: TENANT_A,
    slug: "about",
    lang: "en",
    title: "About",
    body: "# About",
    published: true,
  });
  await seedPage(stack.db, {
    tenantId: TENANT_A,
    slug: "draft",
    lang: "en",
    title: "Draft",
    body: "# Draft",
    published: false,
  });

  const admin = createTestUser({ id: 1, roles: ["TenantAdmin"], tenantId: TENANT_A });
  await stack.http.writeOk(
    "config:write:set",
    { key: SEO_CONFIG_QN.organizationName, value: "Acme" },
    admin,
  );
  await stack.http.writeOk(
    "config:write:set",
    { key: SEO_CONFIG_QN.llmsSummary, value: "Acme builds things." },
    admin,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

describe("seo :: GET /sitemap.xml", () => {
  test("merges the app callback + legal-pages routes + managed-pages published slugs", async () => {
    const res = await stack.app.request("http://a.example.com/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain("<loc>https://a.example.com/</loc>");
    expect(xml).toContain("<loc>http://a.example.com/legal/impressum</loc>");
    expect(xml).toContain("<loc>http://a.example.com/p/about</loc>");
    expect(xml).not.toContain("/p/draft");
  });

  test("cache-control revalidate + etag", async () => {
    const res = await stack.app.request("http://a.example.com/sitemap.xml");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300, must-revalidate");
    expect(res.headers.get("etag")).toBeTruthy();
  });

  test("x-forwarded-proto: https → every merged URL uses https, not the raw http hop", async () => {
    const res = await stack.app.request("http://a.example.com/sitemap.xml", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<loc>https://a.example.com/</loc>");
    expect(xml).toContain("<loc>https://a.example.com/legal/impressum</loc>");
    expect(xml).toContain("<loc>https://a.example.com/p/about</loc>");
    expect(xml).not.toContain("http://a.example.com");
  });

  test("host without a managed-pages tenant → callback + legal-pages entries only", async () => {
    const res = await stack.app.request("http://unknown.example.com/sitemap.xml");
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<loc>https://unknown.example.com/</loc>");
    expect(xml).toContain("/legal/impressum");
    expect(xml).not.toContain("/p/about");
  });
});

describe("seo :: GET /llms.txt", () => {
  test("emits org name + summary + a Pages section with all entries", async () => {
    const res = await stack.app.request("http://a.example.com/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toStartWith("# Acme");
    expect(text).toContain("> Acme builds things.");
    expect(text).toContain("## Pages");
    expect(text).toContain("http://a.example.com/p/about");
  });
});

describe("seo :: GET /robots.txt (not registered without robotsPolicy)", () => {
  test("404 — no route registered", async () => {
    const res = await stack.app.request("http://a.example.com/robots.txt");
    expect(res.status).toBe(404);
  });
});

describe("seo :: GET /robots.txt (opted in)", () => {
  let robotsStack: TestStack;

  beforeAll(async () => {
    const seoWithRobots = createSeoFeature({
      sitemapEntries: () => [],
      includeLegalPages: true,
      robotsPolicy: (host) => ({
        allow: host !== "staging.example.com",
        sitemapUrl: `https://${host}/sitemap.xml`,
      }),
    });
    robotsStack = await setupTestStack({
      features: [createConfigFeature(), seoWithRobots],
      anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
    });
  });

  afterAll(async () => {
    await robotsStack.cleanup();
  });

  test("allow host → no Disallow rule + Sitemap line", async () => {
    const res = await robotsStack.app.request("http://prod.example.com/robots.txt");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("User-agent: *\nDisallow:\nSitemap: https://prod.example.com/sitemap.xml\n");
  });

  test("disallowed host → Disallow: /", async () => {
    const res = await robotsStack.app.request("http://staging.example.com/robots.txt");
    const text = await res.text();
    expect(text).toContain("Disallow: /");
  });
});

describe("seo :: runSeoBootCheck (direct unit-tests)", () => {
  test("has a source (non-empty callback) → log.info, no throw", async () => {
    const infos: string[] = [];
    await expect(
      runSeoBootCheck({
        sitemapEntries: () => [{ loc: "https://x.test/" }],
        includeLegalPages: false,
        hasManagedPages: false,
        log: { info: (m) => infos.push(m) },
      }),
    ).resolves.toBeUndefined();
    expect(infos).toHaveLength(1);
  });

  test("no source + includeLegalPages true → counts as a source", async () => {
    const infos: string[] = [];
    await runSeoBootCheck({
      sitemapEntries: () => [],
      includeLegalPages: true,
      hasManagedPages: false,
      log: { info: (m) => infos.push(m) },
    });
    expect(infos).toHaveLength(1);
  });

  test("no source at all + NODE_ENV=production → throws", async () => {
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      await expect(
        runSeoBootCheck({
          sitemapEntries: () => [],
          includeLegalPages: false,
          hasManagedPages: false,
        }),
      ).rejects.toThrow(/Boot-Validation failed/);
    } finally {
      if (originalEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = originalEnv;
    }
  });

  test("no source at all + NODE_ENV!=production → log.warn, no throw", async () => {
    const warns: string[] = [];
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "development";
    try {
      await runSeoBootCheck({
        sitemapEntries: () => [],
        includeLegalPages: false,
        hasManagedPages: false,
        log: { warn: (m) => warns.push(m) },
      });
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("sitemap.xml/llms.txt will serve an empty document");
    } finally {
      if (originalEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = originalEnv;
    }
  });
});
