import { expect, type Page } from "@playwright/test";

export async function expectProdBootSecure(page: Page): Promise<void> {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) =>
      console.error(
        `Content Security Policy violation: ${event.violatedDirective} ${event.blockedURI}`,
      ),
    );
  });

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toBeTruthy();
  expect(headers["x-content-type-options"]).toBe("nosniff");

  // Not "networkidle": SSE keeps the network open.
  await page.waitForLoadState("load");
  expect(violations).toEqual([]);

  const health = await page.request.get("/health");
  expect(health.status()).toBe(200);
}
