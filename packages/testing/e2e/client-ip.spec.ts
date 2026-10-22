import { syntheticClientIpFor, test } from "@cosmicdrift/kumiko-testing/e2e";
import { expect } from "@playwright/test";
import { perTestClientIpKey } from "../src/e2e/seeded-tenant-fixture";

type EchoedHeaders = { forwardedFor: string | null; cookie: string | null };

test("same-origin api requests carry the per-test client ip and keep cookies", async ({
  page,
  context,
}, testInfo) => {
  await context.addCookies([{ name: "session", value: "abc", url: "http://localhost:4195" }]);
  await page.goto("/");

  const echoed: EchoedHeaders = await page.evaluate(async () => {
    const response = await fetch("/api/echo-headers");
    return response.json();
  });

  expect(echoed.forwardedFor).toBe(syntheticClientIpFor(perTestClientIpKey(testInfo)));
  expect(echoed.cookie).toContain("session=abc");
});

test("a page-level x-forwarded-for wins over the per-test context header", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.9" });
  await page.goto("/");

  const echoed: EchoedHeaders = await page.evaluate(async () => {
    const response = await fetch("/api/echo-headers");
    return response.json();
  });

  expect(echoed.forwardedFor).toBe("203.0.113.9");
});

// Chromium disables its HTTP cache for a context with any route, which re-downloads
// every asset and GET /api/schema on each page.goto. A max-age resource loaded twice
// must reach the server once.
test("the fixture keeps the HTTP cache on", async ({ page, request }, testInfo) => {
  const key = testInfo.testId;
  await page.goto("/");

  const loadCacheable = () =>
    page.evaluate(async (resourceKey) => {
      const response = await fetch(`/cacheable.json?key=${resourceKey}`);
      return response.status;
    }, key);
  await loadCacheable();
  await loadCacheable();

  const hits = await (await request.get(`/cacheable-hits?key=${key}`)).json();
  expect(hits).toEqual({ hits: 1 });
});
