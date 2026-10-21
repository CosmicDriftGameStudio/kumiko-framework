import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { BRANDING_QN, BRANDING_QUERY_QN } from "../branding.ts";
import { createManagedPagesCssFeature } from "../css-gate.ts";
import { createManagedPagesFeature } from "../feature.ts";
import { seedPage } from "../seeding.ts";
import { type PageRow, pageEntity, pagesTable } from "../table.ts";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

// Authenticated admin author. Without an explicit `tenantId`, `createTestUser`
// uses the default tenant and only varies the user ID; `otherAdmin` therefore
// needs an explicit, distinct `tenantId` for cross-tenant isolation.
const tenantAdmin = createTestUser({ id: 10, roles: ["TenantAdmin"] });
const otherAdmin = createTestUser({
  id: 11,
  roles: ["TenantAdmin"],
  tenantId: "33333333-3333-4333-8333-333333333333",
});
const normalUser = createTestUser({ id: 12 });

let stack: TestStack;
// Frozen only by the rate-limit test: no token refills while the 61 requests run.
let frozenNowMs: number | undefined;

// Host → tenant: a.* → A, b.* → B, otherwise no tenant (404). This models
// publicstatus' and studios' subdomain resolution.
const managed = createManagedPagesFeature({
  resolveApexTenant: (host) => {
    if (host.startsWith("a.")) return TENANT_A;
    if (host.startsWith("b.")) return TENANT_B;
    return null;
  },
});

// managed-pages declares `r.requires({ features: ["config"] })` for the branding keys —
// the config feature must be in the stack and `ctx.config` wired.
const configFeature = createConfigFeature();

beforeAll(async () => {
  // No defaultTenantId: it enables single-tenant mode and would reject the
  // per-page X-Tenant (≠ default) with 400 tenant_mismatch. Multi-tenant mode
  // uses the X-Tenant header (clientTenant wins), and tenantExists validates it.
  // This mirrors publicstatus' host-based tenantResolver without a fixed default.
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [configFeature, managed],
    rateLimitNowMs: () => frozenNowMs ?? Date.now(),
    anonymousAccess: {
      tenantExists: async (id) => id === TENANT_A || id === TENANT_B,
    },
    // Wire ctx.config() so the branding query resolves the (X-Tenant) tenant's
    // branding cascade. Branding keys are not encrypted → no encryption needed.
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await unsafeCreateEntityTable(stack.db, pageEntity);
  await unsafePushTables(stack.db, { configValuesTable });

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

afterEach(async () => {
  frozenNowMs = undefined;
  await stack.redis.flushNamespace();
});

afterAll(async () => {
  await stack.cleanup();
});

describe("managed-pages :: server-render route rate limit", () => {
  // by-slug allows 60 calls per IP and window; the 61st must answer 429 with
  // Retry-After, not degrade to 503 "page unavailable".
  test("exhausted bucket → 429 with Retry-After", async () => {
    await stack.redis.flushNamespace();
    const frozenAtMs = Date.now();
    frozenNowMs = frozenAtMs;
    for (let i = 0; i < 60; i++) {
      const res = await stack.app.request("http://a.example.com/p/about");
      expect(res.status).toBe(200);
    }
    const blocked = await stack.app.request("http://a.example.com/p/about");
    expect(blocked.status).toBe(429);
    const retryAfterSeconds = Number(blocked.headers.get("retry-after"));
    expect(retryAfterSeconds).toBeGreaterThan(0);

    frozenNowMs = frozenAtMs + retryAfterSeconds * 1000;
    const afterRefill = await stack.app.request("http://a.example.com/p/about");
    expect(afterRefill.status).toBe(200);
  });
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
  test("Vary: Host + CSP/Hardening-Header + revalidate cache", async () => {
    const res = await stack.app.request("http://a.example.com/p/about");
    expect(res.headers.get("vary")).toBe("Host");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, must-revalidate");
    expect(res.headers.get("etag")).toBeTruthy();
    expect(res.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("If-None-Match → 304 when page unchanged", async () => {
    const first = await stack.app.request("http://a.example.com/p/about");
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const second = await stack.app.request("http://a.example.com/p/about", {
      headers: { "if-none-match": etag ?? "" },
    });
    expect(second.status).toBe(304);
  });

  test("HEAD → 200 without body, etag present", async () => {
    // legal-pages got this HEAD-early-exit test alongside its identical
    // Cache/Header pattern; managed-pages received the same HEAD codepath
    // in the same PR but not the test.
    const res = await stack.app.request("http://a.example.com/p/about", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(res.headers.get("etag")).toBeTruthy();
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

describe("managed-pages :: Admin-Screens registriert", () => {
  test("entityList + entityEdit Screens sind im Feature deklariert", () => {
    const ids = Object.keys(managed.screens);
    expect(ids).toContain("page-list");
    expect(ids).toContain("page-edit");
  });
});

describe("managed-pages :: Convention-CRUD (Admin-Authoring)", () => {
  test("create → list → detail → update(publish) → public-read → delete", async () => {
    await stack.http.writeOk(
      "managed-pages:write:page:create",
      { slug: "crud", lang: "en", title: "CRUD", body: "# Body", published: false },
      tenantAdmin,
    );

    // Retrieve the ID from the list so this test does not depend on the create
    // response shape.
    const list = await stack.http.queryOk<{ rows: Array<{ id: string; slug: string }> }>(
      "managed-pages:query:page:list",
      {},
      tenantAdmin,
    );
    const row = list.rows.find((r) => r.slug === "crud");
    expect(row).toBeTruthy();
    const id = row!.id;

    const detail = await stack.http.queryOk<{ title: string; published: boolean; version: number }>(
      "managed-pages:query:page:detail",
      { id },
      tenantAdmin,
    );
    expect(detail).toMatchObject({ title: "CRUD", published: false });

    // The published-only public query does not expose drafts.
    const draftRead = await stack.http.queryOk<unknown>(
      "managed-pages:query:by-slug",
      { slug: "crud", lang: "en" },
      tenantAdmin,
    );
    expect(draftRead).toBeFalsy();

    await stack.http.writeOk(
      "managed-pages:write:page:update",
      { id, version: detail.version, changes: { published: true, title: "CRUD v2" } },
      tenantAdmin,
    );

    const pubRead = await stack.http.queryOk<{ title: string }>(
      "managed-pages:query:by-slug",
      { slug: "crud", lang: "en" },
      tenantAdmin,
    );
    expect(pubRead).toMatchObject({ title: "CRUD v2" });

    await stack.http.writeOk("managed-pages:write:page:delete", { id }, tenantAdmin);
    const afterDelete = await stack.http.queryOk<unknown>(
      "managed-pages:query:page:detail",
      { id },
      tenantAdmin,
    );
    expect(afterDelete).toBeFalsy();
  });

  test("normaler User darf nicht erstellen (access_denied)", async () => {
    const error = await stack.http.writeErr(
      "managed-pages:write:page:create",
      { slug: "denied", lang: "en", title: "x", body: null },
      normalUser,
    );
    expectErrorIncludes(error, "access_denied");
  });

  test("Cross-Tenant-Isolation: List zeigt nur eigene Pages", async () => {
    await stack.http.writeOk(
      "managed-pages:write:page:create",
      { slug: "tenant-a-only", lang: "en", title: "A only", body: "x", published: false },
      tenantAdmin,
    );
    const otherList = await stack.http.queryOk<{ rows: Array<{ slug: string }> }>(
      "managed-pages:query:page:list",
      {},
      otherAdmin,
    );
    expect(otherList.rows.some((r) => r.slug === "tenant-a-only")).toBe(false);
  });
});

describe("managed-pages :: set (Provisioning-API)", () => {
  test("idempotenter slug-keyed Upsert + preserve-on-omit (published)", async () => {
    const first = await stack.http.writeOk<{ isNew: boolean }>(
      "managed-pages:write:set",
      { slug: "prov", lang: "en", title: "Prov v1", body: "a", published: true },
      tenantAdmin,
    );
    expect(first).toMatchObject({ isNew: true });

    // The second call updates the same slug+lang; omitting published preserves its value.
    const second = await stack.http.writeOk<{ isNew: boolean }>(
      "managed-pages:write:set",
      { slug: "prov", lang: "en", title: "Prov v2", body: "b" },
      tenantAdmin,
    );
    expect(second).toMatchObject({ isNew: false });

    // Verify that published was preserved when omitted: the public query returns
    // the page with its updated title.
    const read = await stack.http.queryOk<{ title: string }>(
      "managed-pages:query:by-slug",
      { slug: "prov", lang: "en" },
      tenantAdmin,
    );
    expect(read).toMatchObject({ title: "Prov v2" });
  });
});

// The SystemAdmin-only `tenantIdOverride` cross-tenant write path had zero
// coverage: not the happy path, not the access guard, not the
// documented `executorUser`-rebase fix (the override must rebase the executor's
// tenant or getStreamVersion runs against the wrong tenant → version_conflict
// on the second write).
describe("managed-pages :: set with tenantIdOverride (cross-tenant, SystemAdmin)", () => {
  const sysAdmin = createTestUser({ id: 40, roles: ["SystemAdmin"] }); // distinct tenant

  test("(a) SystemAdmin override writes the row under the TARGET tenant", async () => {
    const res = await stack.http.writeOk<{ isNew: boolean }>(
      "managed-pages:write:set",
      {
        slug: "sys-cross",
        lang: "en",
        title: "Cross-tenant by system",
        body: "x",
        published: true,
        tenantIdOverride: TENANT_A,
      },
      sysAdmin,
    );
    expect(res).toMatchObject({ isNew: true });

    // The persisted row carries TENANT_A — not the SystemAdmin's own tenant.
    const row = await fetchOne<PageRow>(stack.db, pagesTable, {
      tenantId: TENANT_A,
      slug: "sys-cross",
      lang: "en",
    });
    expect(row?.tenantId).toBe(TENANT_A);
    expect(row?.title).toBe("Cross-tenant by system");

    // The stream lives in the target tenant while the operator stays the actor.
    const events = await selectMany<{ tenantId: string; createdBy: string }>(
      stack.db,
      eventsTable,
      { aggregateId: row?.id },
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.tenantId).toBe(TENANT_A);
    expect(events[0]?.createdBy).toBe(sysAdmin.id);

    // End-to-end: it renders under a.* (TENANT_A) and is absent under b.*.
    const aHtml = await (await stack.app.request("http://a.example.com/p/sys-cross")).text();
    expect(aHtml).toContain("Cross-tenant by system");
    const bRes = await stack.app.request("http://b.example.com/p/sys-cross");
    expect(bRes.status).toBe(404);
  });

  test("(b) non-SystemAdmin with tenantIdOverride → access_denied", async () => {
    const error = await stack.http.writeErr(
      "managed-pages:write:set",
      { slug: "sneak", lang: "en", title: "x", body: "y", tenantIdOverride: TENANT_B },
      tenantAdmin, // TenantAdmin, NOT SystemAdmin
    );
    expectErrorIncludes(error, "access_denied");
    expect(JSON.stringify(error)).toContain("tenant_override_requires_system_admin");

    // The write was rejected — no row leaked into TENANT_B.
    const leaked = await fetchOne<PageRow>(stack.db, pagesTable, {
      tenantId: TENANT_B,
      slug: "sneak",
      lang: "en",
    });
    expect(leaked).toBeFalsy();
  });

  test("(c) SystemAdmin override on an EXISTING page updates it — no version_conflict", async () => {
    // First override-write creates the row under TENANT_A.
    await stack.http.writeOk(
      "managed-pages:write:set",
      {
        slug: "sys-rebase",
        lang: "en",
        title: "v1",
        body: "a",
        published: true,
        tenantIdOverride: TENANT_A,
      },
      sysAdmin,
    );

    // Second override-write must hit the UPDATE path. Two prior bugs broke this:
    // (1) the existing-check used the tenant-scoped ctx.db → blind to the target
    // tenant's row → create → unique_violation; (2) even reaching update,
    // getStreamVersion ran against the executor's tenant → version_conflict.
    // The fix reads the existing row through the unscoped runner AND rebases the
    // executor user to the override tenant.
    const second = await stack.http.writeOk<{ isNew: boolean }>(
      "managed-pages:write:set",
      { slug: "sys-rebase", lang: "en", title: "v2", body: "b", tenantIdOverride: TENANT_A },
      sysAdmin,
    );
    expect(second).toMatchObject({ isNew: false });

    const html = await (await stack.app.request("http://a.example.com/p/sys-rebase")).text();
    expect(html).toContain("v2");
  });
});

describe("managed-pages :: by-tenant-published (Discovery-Query)", () => {
  // tenantAdmin/otherAdmin operate under the default test tenant + a third
  // tenant (see file header) — neither is TENANT_A/TENANT_B, so this needs
  // its own explicit-tenantId users (same pattern as adminA/adminB below).
  const pageAdminA = createTestUser({ id: 14, roles: ["TenantAdmin"], tenantId: TENANT_A });
  const pageAdminB = createTestUser({ id: 15, roles: ["TenantAdmin"], tenantId: TENANT_B });

  test("listet nur published Pages des Tenants, SQL-gefiltert (Drafts fehlen)", async () => {
    const res = await stack.http.queryOk<{
      pages: Array<{ slug: string; lang: string; title: string }>;
    }>("managed-pages:query:by-tenant-published", {}, pageAdminA);
    const slugs = res.pages.map((p) => p.slug);
    expect(slugs).toContain("about");
    expect(slugs).not.toContain("secret");
  });

  test("Cross-Tenant-Isolation: TENANT_B sieht nur eigene Slugs, keine von TENANT_A", async () => {
    const res = await stack.http.queryOk<{ pages: Array<{ slug: string; title: string }> }>(
      "managed-pages:query:by-tenant-published",
      {},
      pageAdminB,
    );
    expect(res.pages).toEqual([expect.objectContaining({ slug: "about", title: "About B" })]);
  });
});

describe("managed-pages :: Branding (Config + Render)", () => {
  // config:write:set derives tenantId from user.tenantId, so tenant-specific
  // admins store branding for TENANT_A or TENANT_B (hosts a.*/b.*).
  const adminA = createTestUser({ id: 20, roles: ["TenantAdmin"], tenantId: TENANT_A });
  const adminB = createTestUser({ id: 21, roles: ["TenantAdmin"], tenantId: TENANT_B });

  test("configEdit-Screen branding-settings ist registriert", () => {
    expect(Object.keys(managed.screens)).toContain("branding-settings");
  });

  test("Custom-CSS-Key NICHT registriert ohne allowCustomCss (fail-closed-by-construction)", async () => {
    // With allowCustomCss=false, the branding-custom-css key is not registered and
    // writes are rejected. This preserves the fail-closed behavior if keys are
    // ever registered unconditionally.
    const error = await stack.http.writeErr(
      "config:write:set",
      { key: BRANDING_QN.customCss, value: ".x { color: red; }" },
      adminA,
    );
    expect(error).toBeTruthy();
  });

  test("valides Branding (Hex + https + Preset) wird gesetzt und im Render angewandt", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.accentColor, value: "#ff8800" },
      adminA,
    );
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.logoUrl, value: "https://cdn-a.example.com/logo.png" },
      adminA,
    );
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.title, value: "Acme A" },
      adminA,
    );
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.layoutPreset, value: "wide" },
      adminA,
    );
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.description, value: "Acme status and docs" },
      adminA,
    );

    const html = await (await stack.app.request("http://a.example.com/p/about")).text();
    // Scoped :root override with the accent color and preset max-width.
    expect(html).toContain('<style id="tenant-theme">');
    expect(html).toContain("--accent:#ff8800");
    expect(html).toContain("--page-max-width:1100px");
    // Logo + Titel im Branding-Header
    expect(html).toContain('src="https://cdn-a.example.com/logo.png"');
    expect(html).toContain("Acme A");
    // The branding description becomes site-default metadata because "about" has none.
    expect(html).toContain('<meta name="description" content="Acme status and docs">');
  });

  test("invalide Accent-Farbe (kein Hex, CSS-Injection-Versuch) → Write abgelehnt", async () => {
    const error = await stack.http.writeErr(
      "config:write:set",
      { key: BRANDING_QN.accentColor, value: "red; } body{display:none}" },
      adminA,
    );
    expectErrorIncludes(error, "invalid_format");
  });

  test("non-https Logo-URL → Write abgelehnt", async () => {
    const error = await stack.http.writeErr(
      "config:write:set",
      { key: BRANDING_QN.logoUrl, value: "http://insecure.example.com/logo.png" },
      adminA,
    );
    expectErrorIncludes(error, "invalid_format");
  });

  test("leerer Wert (clear) ist erlaubt — Pattern allow-empty", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.siteUrl, value: "https://acme.test" },
      adminA,
    );
    await stack.http.writeOk("config:write:set", { key: BRANDING_QN.siteUrl, value: "" }, adminA);
    const branding = await stack.http.queryOk<{ siteUrl: string }>(BRANDING_QUERY_QN, {}, adminA);
    expect(branding.siteUrl).toBe("");
  });

  test("über-langer Title (>200) → Write abgelehnt (Server-Längen-Cap)", async () => {
    const error = await stack.http.writeErr(
      "config:write:set",
      { key: BRANDING_QN.title, value: "x".repeat(201) },
      adminA,
    );
    expectErrorIncludes(error, "invalid_format");
  });

  test("Cross-Tenant-Isolation: TENANT_A-Branding leakt nicht auf TENANT_B", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.accentColor, value: "#0033cc" },
      adminB,
    );
    const htmlB = await (await stack.app.request("http://b.example.com/p/about")).text();
    expect(htmlB).toContain("--accent:#0033cc");
    expect(htmlB).not.toContain("#ff8800");
    expect(htmlB).not.toContain("cdn-a.example.com");
    expect(htmlB).not.toContain("Acme A");
  });

  // The actual gate: a provisioning/migration seed sets a tenant
  // branding key via the system executor. createSystemUser(tenant) is the
  // exact identity ctx.systemWriteAs injects (roles=[SYSTEM_ROLE]); stack.
  // dispatcher is the same command path systemWriteAs drives. Before the
  // access.withSystem(access.admin) write-role, this returned access_denied
  // (forcing the publicstatus migration onto raw SQL). Drives the REAL
  // config:write:set handler end-to-end and reads the value back per tenant —
  // a unit test on checkWriteAccess alone wouldn't prove the handler accepts it.
  test("system executor provisions a branding key (systemWriteAs path), read back per tenant", async () => {
    const res = await stack.dispatcher.write(
      "config:write:set",
      { key: BRANDING_QN.title, value: "Provisioned by system" },
      createSystemUser(TENANT_A),
    );
    expect(res.isSuccess).toBe(true);

    const branding = await stack.http.queryOk<{ title: string }>(BRANDING_QUERY_QN, {}, adminA);
    expect(branding.title).toBe("Provisioned by system");

    // The provisioned value lands on TENANT_A only — not leaked to TENANT_B.
    const brandingB = await stack.http.queryOk<{ title: string }>(BRANDING_QUERY_QN, {}, adminB);
    expect(brandingB.title).not.toBe("Provisioned by system");
  });
});

// Separate stack with allowCustomCss:true and the companion toggle feature. The
// per-tenant gate is simulated through `effectiveFeatures`: TENANT_A enables
// `managed-pages-css`, while TENANT_B disables it: same app opt-in
// (allowCustomCss), different operator/tier toggle. This verifies end-to-end
// rendering, the kill switch, and that the render sanitizer catches values that
// bypassed the write-path validation.
describe("managed-pages :: Custom CSS (gated, sanitized render)", () => {
  let cssStack: TestStack;
  const cssAdminA = createTestUser({ id: 30, roles: ["TenantAdmin"], tenantId: TENANT_A });
  const cssAdminB = createTestUser({ id: 31, roles: ["TenantAdmin"], tenantId: TENANT_B });

  const managedWithCss = createManagedPagesFeature({
    resolveApexTenant: (host) => {
      if (host.startsWith("a.")) return TENANT_A;
      if (host.startsWith("b.")) return TENANT_B;
      return null;
    },
    allowCustomCss: true,
  });
  const cssGate = createManagedPagesCssFeature();
  const cssConfigFeature = createConfigFeature();

  beforeAll(async () => {
    const resolver = createConfigResolver();
    cssStack = await setupTestStack({
      features: [cssConfigFeature, managedWithCss, cssGate],
      anonymousAccess: {
        tenantExists: async (id) => id === TENANT_A || id === TENANT_B,
      },
      // Per-Tenant-Toggle: A enabled, B disabled.
      effectiveFeatures: (tid) =>
        tid === TENANT_A
          ? new Set(["config", "managed-pages", "managed-pages-css"])
          : new Set(["config", "managed-pages"]),
      extraContext: ({ registry }) => ({
        configResolver: resolver,
        _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      }),
    });
    await unsafeCreateEntityTable(cssStack.db, pageEntity);
    await unsafePushTables(cssStack.db, { configValuesTable });
    await seedPage(cssStack.db, {
      tenantId: TENANT_A,
      slug: "about",
      lang: "en",
      title: "About A",
      body: "# A",
      published: true,
    });
    await seedPage(cssStack.db, {
      tenantId: TENANT_B,
      slug: "about",
      lang: "en",
      title: "About B",
      body: "# B",
      published: true,
    });
  });

  afterAll(async () => {
    await cssStack.cleanup();
  });

  test("custom-css Config-Key ist registriert wenn allowCustomCss (Write ok)", async () => {
    await cssStack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.customCss, value: ".note { color: red; }" },
      cssAdminA,
    );
    // The branding query returns the raw customCss, proving both that the key is
    // registered and that its value persists—not merely that the write succeeds.
    const branding = await cssStack.http.queryOk<{ customCss?: string }>(
      BRANDING_QUERY_QN,
      {},
      cssAdminA,
    );
    expect(branding.customCss).toContain(".note");
  });

  test("Gate AN: Tenant-CSS gescoped in <style data-tenant-css> gerendert", async () => {
    await cssStack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.customCss, value: ".note { color: rebeccapurple; }" },
      cssAdminA,
    );
    const html = await (await cssStack.app.request("http://a.example.com/p/about")).text();
    expect(html).toContain("<style data-tenant-css>");
    expect(html).toContain("[data-tenant-content] .note");
    expect(html).toContain("color: rebeccapurple");
    expect(html).toContain("<main data-tenant-content>");
    // full containment (position/isolation + overflow clip) ships in the
    // tenant-css block, only alongside tenant CSS — boxes + clips tenant paint
    // off host chrome.
    expect(html).toContain("[data-tenant-content]{position:relative;isolation:isolate}");
    expect(html).toContain("[data-tenant-content]{overflow:hidden}");
  });

  test("gespeichertes Angriffs-CSS wird am Render sanitized (Write-Gate-Bypass-Abwehr)", async () => {
    // The length-cap pattern permits storage; the render sanitizer is the actual
    // allowlist gate, so each attack vector is tested separately.
    const attack =
      ".evil { position: fixed; top: 0; } .ok { color: red; } @import url('http://evil.test');";
    await cssStack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.customCss, value: attack },
      cssAdminA,
    );
    const html = await (await cssStack.app.request("http://a.example.com/p/about")).text();
    expect(html).not.toContain("position: fixed");
    expect(html).not.toContain("@import");
    expect(html).not.toContain("evil.test");
    // The one safe rule survives, scoped to tenant content.
    expect(html).toContain("[data-tenant-content] .ok");
    expect(html).toContain("color: red");
  });

  test("Gate AUS (Toggle off für Tenant B): kein Tenant-CSS trotz gespeichertem Wert", async () => {
    await cssStack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.customCss, value: ".note { color: red; }" },
      cssAdminB,
    );
    const html = await (await cssStack.app.request("http://b.example.com/p/about")).text();
    expect(html).not.toContain("<style data-tenant-css>");
    expect(html).not.toContain("[data-tenant-content] .note");
    // no tenant CSS → no clip (plain pages keep normal overflow for wide content)
    expect(html).not.toContain("overflow:hidden");
  });

  test("configEdit-Screen zeigt das customCss-Feld wenn allowCustomCss", () => {
    const screen = managedWithCss.screens["branding-settings"];
    expect(screen).toBeTruthy();
    expect(JSON.stringify(screen)).toContain("branding-custom-css");
  });
});

// resolverTrust: "authoritative": this suite wires a real host-based
// anonymousAccess. It uses tenantResolver rather than only tenantExists, matching
// the configuration used by publicstatus/show-pony.
//
// An internal self-fetch (the former app.fetch path) has no Host header; the host
// exists only in the request URL. A resolver that, like publicstatus' real
// resolver, reads only c.req.header("host") therefore resolves null for the
// internal request. With resolverTrust: "authoritative", there is no client-tenant
// fallback, producing tenant_required and then "page unavailable" 503 even though
// the outer request resolved the tenant correctly. systemQuery (see feature.ts)
// removes the internal HTTP round trip and passes the resolved tenantId in-process.
// The fallback-free resolver and systemQuery path verify this behavior end to end.
describe("managed-pages :: resolverTrust authoritative (host-based, wie publicstatus/show-pony)", () => {
  let authStack: TestStack;
  const authManaged = createManagedPagesFeature({
    resolveApexTenant: (host) => {
      if (host.startsWith("a.")) return TENANT_A;
      if (host.startsWith("b.")) return TENANT_B;
      return null;
    },
  });
  const authConfigFeature = createConfigFeature();
  const hostTenant = (host: string): string | null => {
    if (host.startsWith("a.")) return TENANT_A;
    if (host.startsWith("b.")) return TENANT_B;
    return null;
  };

  beforeAll(async () => {
    const resolver = createConfigResolver();
    authStack = await setupTestStack({
      features: [authConfigFeature, authManaged],
      anonymousAccess: {
        // No URL fallback—this mirrors publicstatus' real resolver
        // (resolveSubdomain(c.req.header("Host") ?? "")). An internal
        // self-fetch has no Host header; the host exists only in the URL, not
        // in Headers, so a header-only resolver returns null. A URL fallback
        // would mask this bug.
        tenantResolver: (c) => hostTenant(c.req.header("host") ?? ""),
        resolverTrust: "authoritative",
        tenantExists: async (id) => id === TENANT_A || id === TENANT_B,
      },
      extraContext: ({ registry }) => ({
        configResolver: resolver,
        _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      }),
    });
    await unsafeCreateEntityTable(authStack.db, pageEntity);
    await unsafePushTables(authStack.db, { configValuesTable });
    await seedPage(authStack.db, {
      tenantId: TENANT_A,
      slug: "about",
      lang: "en",
      title: "About A",
      body: "# Hello from **A**",
      published: true,
    });
    await seedPage(authStack.db, {
      tenantId: TENANT_B,
      slug: "about",
      lang: "en",
      title: "About B",
      body: "# Hello from **B**",
      published: true,
    });
  });

  afterAll(async () => {
    await authStack.cleanup();
  });

  test("published Page → 200 (systemQuery-Render-Pfad übersteht authoritative resolver)", async () => {
    const res = await authStack.app.request("http://a.example.com/p/about");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("About A");
    expect(html).toContain("<strong>A</strong>");
  });

  test("Cross-Tenant-Isolation: Host löst den jeweils eigenen Tenant auf", async () => {
    const a = await (await authStack.app.request("http://a.example.com/p/about")).text();
    const b = await (await authStack.app.request("http://b.example.com/p/about")).text();
    expect(a).toContain("About A");
    expect(a).not.toContain("About B");
    expect(b).toContain("About B");
    expect(b).not.toContain("About A");
  });

  test("X-Tenant-Header auf der Render-Route ist wirkungslos — Host bleibt allein maßgeblich", async () => {
    // The render route resolves the tenant only through resolveApexTenant(host),
    // never through the client header. Unlike query/write dispatch, it has no
    // X-Tenant override path, so a conflicting header is ignored: the response
    // remains 200 and serves A's page.
    const res = await authStack.app.request("http://a.example.com/p/about", {
      headers: { "X-Tenant": TENANT_B },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("About A");
    expect(body).not.toContain("About B");
  });
});
