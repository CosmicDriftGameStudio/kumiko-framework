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

test("an explicit x-forwarded-for set by the test wins", async ({ page }) => {
  await page.goto("/");

  const echoed: EchoedHeaders = await page.evaluate(async () => {
    const response = await fetch("/api/echo-headers", {
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    return response.json();
  });

  expect(echoed.forwardedFor).toBe("203.0.113.9");
});
