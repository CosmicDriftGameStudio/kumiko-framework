import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { BRANDING_QN, pageEntity } from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import { seedPage } from "@cosmicdrift/kumiko-bundled-features/managed-pages/seeding";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { configFeature, managedPagesCssFeature, managedPagesFeature } from "../feature";

// Branding writes are tenant-scoped — the admin's tenantId must equal the
// rendered tenant (SYSTEM_TENANT_ID here), or the config row lands in the wrong
// bucket and the render reads the default.
const admin = createTestUser({ id: 1, roles: ["TenantAdmin"], tenantId: SYSTEM_TENANT_ID });

let stack: TestStack;

const render = async (path: string): Promise<string> => {
  const res = await stack.app.request(`http://acme.example.com${path}`);
  return res.text();
};

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [configFeature, managedPagesFeature, managedPagesCssFeature],
    // Single-tenant: resolveApexTenant returns SYSTEM_TENANT_ID, so the route's
    // X-Tenant header matches this defaultTenantId — no tenant_mismatch.
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
    // Wire ctx.config() so the branding query resolves the tenant's cascade.
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await unsafeCreateEntityTable(stack.db, pageEntity);
  await unsafePushTables(stack.db, { configValuesTable });
  await createEventsTable(stack.db);

  await seedPage(stack.db, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "about",
    lang: "en",
    title: "About Acme",
    body: "# Hello from **Acme**",
    published: true,
  });
  await seedPage(stack.db, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "draft",
    lang: "en",
    title: "Draft",
    body: "not live yet",
    published: false,
  });
  await seedPage(stack.db, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "xss",
    lang: "en",
    title: "XSS probe",
    body: "intro\n\n<script>alert('pwned')</script>\n\nfin",
    published: true,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("recipe :: managed-pages render", () => {
  test("published page → 200 with rendered Markdown + Vary: Host", async () => {
    const res = await stack.app.request("http://acme.example.com/p/about");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("vary")).toBe("Host");
    const html = await res.text();
    expect(html).toContain("About Acme");
    expect(html).toContain("<strong>Acme</strong>");
  });

  test("unpublished draft → 404 for anonymous visitors", async () => {
    const res = await stack.app.request("http://acme.example.com/p/draft");
    expect(res.status).toBe(404);
  });

  test("raw HTML in a Markdown body is escaped, never executed", async () => {
    const html = await render("/p/xss");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("recipe :: branding (config self-service)", () => {
  test("accent color + title roundtrip into the render", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.accentColor, value: "#ff0066" },
      admin,
    );
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.title, value: "Acme Inc" },
      admin,
    );
    const html = await render("/p/about");
    expect(html).toContain("#ff0066");
    expect(html).toContain("Acme Inc");
  });
});

describe("recipe :: custom CSS (allowCustomCss, sanitized)", () => {
  test("safe rule renders scoped + contained in <style data-tenant-css>", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.customCss, value: ".note { color: rebeccapurple; }" },
      admin,
    );
    const html = await render("/p/about");
    expect(html).toContain("<style data-tenant-css>");
    expect(html).toContain("[data-tenant-content] .note");
    expect(html).toContain("color: rebeccapurple");
    expect(html).toContain("<main data-tenant-content>");
    expect(html).toContain("[data-tenant-content]{overflow:hidden}");
  });

  test("attack CSS is neutralized at render; the one safe rule survives scoped", async () => {
    const attack =
      ".evil { position: fixed; top: 0; } .ok { color: red; } @import url('http://evil.test');";
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.customCss, value: attack },
      admin,
    );
    const html = await render("/p/about");
    expect(html).not.toContain("position: fixed");
    expect(html).not.toContain("@import");
    expect(html).not.toContain("evil.test");
    expect(html).toContain("[data-tenant-content] .ok");
    expect(html).toContain("color: red");
  });
});
