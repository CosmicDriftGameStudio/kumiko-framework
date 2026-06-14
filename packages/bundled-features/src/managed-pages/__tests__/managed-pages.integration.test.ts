import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createManagedPagesFeature } from "../feature";
import { seedPage } from "../seeding";
import { pageEntity } from "../table";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

let stack: TestStack;

// Host → Tenant: a.* → A, b.* → B, sonst kein Tenant (404). Steht für
// publicstatus' Subdomain-Auflösung bzw. studios eigene.
const managed = createManagedPagesFeature({
  resolveApexTenant: (host) => {
    if (host.startsWith("a.")) return TENANT_A;
    if (host.startsWith("b.")) return TENANT_B;
    return null;
  },
});

beforeAll(async () => {
  // KEIN defaultTenantId — der lockt Single-Tenant-Modus und würde den
  // per-Page-Route gesetzten X-Tenant (≠ default) mit 400 tenant_mismatch
  // ablehnen. Multi-Tenant nutzt den X-Tenant-Header (clientTenant gewinnt),
  // tenantExists validiert ihn. Spiegelt publicstatus (host-basierter
  // tenantResolver, kein fixer default).
  stack = await setupTestStack({
    features: [managed],
    anonymousAccess: {
      tenantExists: async (id) => id === TENANT_A || id === TENANT_B,
    },
  });
  await unsafeCreateEntityTable(stack.db, pageEntity);
  await createEventsTable(stack.db);

  await seedPage(stack.db, {
    tenantId: TENANT_A,
    slug: "about",
    lang: "en",
    title: "About A",
    body: "# Hello from **A**",
    published: true,
  });
  await seedPage(stack.db, {
    tenantId: TENANT_A,
    slug: "secret",
    lang: "en",
    title: "Secret A",
    body: "draft only",
    published: false,
  });
  await seedPage(stack.db, {
    tenantId: TENANT_B,
    slug: "about",
    lang: "en",
    title: "About B",
    body: "# Hello from **B**",
    published: true,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("managed-pages :: server-render route", () => {
  test("published Page → 200 mit gerendertem Markdown", async () => {
    const res = await stack.app.request("http://a.example.com/p/about");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("About A");
    expect(html).toContain("<strong>A</strong>");
    expect(html).toContain('lang="en"');
  });

  test("Draft (unpublished) → 404 für anonyme Besucher", async () => {
    const res = await stack.app.request("http://a.example.com/p/secret");
    expect(res.status).toBe(404);
  });

  test("unbekannter Slug → 404", async () => {
    const res = await stack.app.request("http://a.example.com/p/nope");
    expect(res.status).toBe(404);
  });

  test("Host ohne Tenant (resolveApexTenant null) → 404", async () => {
    const res = await stack.app.request("http://unknown.example.com/p/about");
    expect(res.status).toBe(404);
  });
});

describe("managed-pages :: Cross-Tenant-Isolation", () => {
  test("derselbe Slug serviert pro Host den jeweiligen Tenant-Content", async () => {
    const a = await (await stack.app.request("http://a.example.com/p/about")).text();
    const b = await (await stack.app.request("http://b.example.com/p/about")).text();
    expect(a).toContain("About A");
    expect(a).not.toContain("About B");
    expect(b).toContain("About B");
    expect(b).not.toContain("About A");
  });
});

describe("managed-pages :: Cache + Security-Header", () => {
  test("Vary: Host + CSP/Hardening-Header", async () => {
    const res = await stack.app.request("http://a.example.com/p/about");
    expect(res.headers.get("vary")).toBe("Host");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("managed-pages :: XSS-Härtung", () => {
  test("<script> im Page-Body wird escaped", async () => {
    await seedPage(stack.db, {
      tenantId: TENANT_A,
      slug: "xss",
      lang: "en",
      title: "XSS",
      body: "## Test\n\n<script>window.x=1</script>\n\nok",
      published: true,
    });
    const res = await stack.app.request("http://a.example.com/p/xss");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("<script>window.x=1</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
