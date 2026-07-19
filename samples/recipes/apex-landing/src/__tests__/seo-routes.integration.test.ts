// Shows the seo feature mounted alongside a real (albeit toy) apex route —
// the landing recipe itself stays a pure function (renderApexPage in,
// HTML string out, nothing to boot); this is the thin httpRoute an app
// would add to actually serve it, wired to a live setupTestStack so
// /sitemap.xml and /llms.txt are exercised as real HTTP requests, not just
// asserted against the ApexPage data shape.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createSeoFeature } from "@cosmicdrift/kumiko-bundled-features/seo";
import { defineFeature, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { renderLanding, SAMPLE_PLANS } from "../feature";

const LANDING_URL = "https://tasklane.example/";

const landingFeature = defineFeature("landing", (r) => {
  r.describe("Serves the recipe's renderLanding() output at GET /.");
  r.httpRoute({
    method: "GET",
    path: "/",
    anonymous: true,
    handler: (c) => c.html(renderLanding({ plans: SAMPLE_PLANS })),
  });
  return {};
});

const seo = createSeoFeature({
  sitemapEntries: () => [{ loc: LANDING_URL, changefreq: "weekly" }],
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), landingFeature, seo],
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("apex-landing + seo :: mounted together on one stack", () => {
  test("GET / serves the landing page, including the schema.org JSON-LD", async () => {
    const res = await stack.app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"Organization"');
    expect(html).toContain('"@type":"WebPage"');
  });

  test("GET /sitemap.xml lists the landing page URL", async () => {
    const res = await stack.app.request("/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain(`<loc>${LANDING_URL}</loc>`);
  });

  test("GET /llms.txt lists the landing page URL", async () => {
    const res = await stack.app.request("/llms.txt");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(LANDING_URL);
  });
});
