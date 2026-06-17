import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { BRANDING_QN, BRANDING_QUERY_QN } from "../branding";
import { createManagedPagesCssFeature } from "../css-gate";
import { createManagedPagesFeature } from "../feature";
import { seedPage } from "../seeding";
import { pageEntity } from "../table";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

// Authenticated Admin-Authoring-User. `createTestUser` ohne explizite
// tenantId teilt den Default-Tenant (nur `id` variiert die User-Id) — für
// die Cross-Tenant-Isolation braucht `otherAdmin` daher eine EXPLIZITE,
// distinkte tenantId.
const tenantAdmin = createTestUser({ id: 10, roles: ["TenantAdmin"] });
const otherAdmin = createTestUser({
  id: 11,
  roles: ["TenantAdmin"],
  tenantId: "33333333-3333-4333-8333-333333333333",
});
const normalUser = createTestUser({ id: 12 });

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

// managed-pages declares `r.requires("config")` for the branding keys —
// the config feature must be in the stack and `ctx.config` wired.
const configFeature = createConfigFeature();

beforeAll(async () => {
  // KEIN defaultTenantId — der lockt Single-Tenant-Modus und würde den
  // per-Page-Route gesetzten X-Tenant (≠ default) mit 400 tenant_mismatch
  // ablehnen. Multi-Tenant nutzt den X-Tenant-Header (clientTenant gewinnt),
  // tenantExists validiert ihn. Spiegelt publicstatus (host-basierter
  // tenantResolver, kein fixer default).
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [configFeature, managed],
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

    // id robust über die Liste holen (unabhängig von der create-Return-Shape).
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

    // Draft ist über die Public-Query (published-only) unsichtbar.
    const draftRead = await stack.http.queryOk<unknown>(
      "managed-pages:query:by-slug",
      { slug: "crud", lang: "en" },
      tenantAdmin,
    );
    expect(draftRead).toBeFalsy();

    // update: publish + Title ändern.
    await stack.http.writeOk(
      "managed-pages:write:page:update",
      { id, version: detail.version, changes: { published: true, title: "CRUD v2" } },
      tenantAdmin,
    );

    // Public-Query liefert die Page jetzt (published) mit neuem Title.
    const pubRead = await stack.http.queryOk<{ title: string }>(
      "managed-pages:query:by-slug",
      { slug: "crud", lang: "en" },
      tenantAdmin,
    );
    expect(pubRead).toMatchObject({ title: "CRUD v2" });

    // delete → detail ist weg.
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

    // Zweiter Call = Update (selber slug+lang); published bei Omit erhalten.
    const second = await stack.http.writeOk<{ isNew: boolean }>(
      "managed-pages:write:set",
      { slug: "prov", lang: "en", title: "Prov v2", body: "b" },
      tenantAdmin,
    );
    expect(second).toMatchObject({ isNew: false });

    // Beweis: published blieb true (preserve-on-omit) → Public-Query liefert
    // die Page mit aktualisiertem Title.
    const read = await stack.http.queryOk<{ title: string }>(
      "managed-pages:query:by-slug",
      { slug: "prov", lang: "en" },
      tenantAdmin,
    );
    expect(read).toMatchObject({ title: "Prov v2" });
  });
});

describe("managed-pages :: Branding (Config + Render)", () => {
  // config:write:set leitet tenantId aus user.tenantId ab → tenant-spezifische
  // Admins, damit das Branding auf TENANT_A bzw. TENANT_B landet (Host a.*/b.*).
  const adminA = createTestUser({ id: 20, roles: ["TenantAdmin"], tenantId: TENANT_A });
  const adminB = createTestUser({ id: 21, roles: ["TenantAdmin"], tenantId: TENANT_B });

  test("configEdit-Screen branding-settings ist registriert", () => {
    expect(Object.keys(managed.screens)).toContain("branding-settings");
  });

  test("Custom-CSS-Key NICHT registriert ohne allowCustomCss (fail-closed-by-construction)", async () => {
    // Default `managed` stack hat allowCustomCss=false → der branding-custom-css
    // Key existiert nicht → ein Write darauf wird abgelehnt. Sperrt die
    // Fail-closed-Eigenschaft gegen eine künftige "Key-immer-registrieren"-Regression.
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
    // scoped :root-Override mit Accent + Preset-max-width
    expect(html).toContain('<style id="tenant-theme">');
    expect(html).toContain("--accent:#ff8800");
    expect(html).toContain("--page-max-width:1100px");
    // Logo + Titel im Branding-Header
    expect(html).toContain('src="https://cdn-a.example.com/logo.png"');
    expect(html).toContain("Acme A");
    // branding-description als Site-Default-Meta (Seite "about" hat keine eigene)
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

  // #396 — the actual gate: a provisioning/migration seed sets a tenant
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

// Eigener Stack mit allowCustomCss:true + dem Companion-Toggle-Feature. Der
// per-Tenant-Gate wird über `effectiveFeatures` simuliert: TENANT_A hat
// `managed-pages-css` AN, TENANT_B AUS — gleiche App-Opt-in (allowCustomCss),
// unterschiedlicher Operator-/Tier-Toggle. Beweist End-to-End-Render + den
// Kill-Switch + dass der Render-Sanitizer Write-Bypass-Werte abfängt.
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
    await createEventsTable(cssStack.db);
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
    // Gate AN → die branding-Query gibt den (rohen) customCss zurück; beweist
    // dass der Key registriert ist UND der Wert persistiert (nicht nur „kein
    // Write-Fehler").
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
    // Der Längen-Cap-Pattern lässt das speichern; der Render-Sanitizer ist der
    // eigentliche Allowlist-Gate. Jeder Vektor einzeln exerziert.
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
    // die eine sichere Regel überlebt, gescoped
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
