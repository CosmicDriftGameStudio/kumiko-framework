// @runtime test
// Side-by-side shots: custom upload screen on FormScreenLayout vs the standard
// entityEdit screen form. Runs only with SCREENSHOT_DIR set.

import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 900 } });

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await captureScreenshot(page, name);
}

test("p6-upload-layout-desktop", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/upload-standard-layout");
  await expect(page.getByTestId("upload-zone-section-title")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "Rechnung-Hausmeisterdienst-Oktober.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
  });
  await expect(page.getByTestId("upload-result-list")).toContainText(
    "Rechnung-Hausmeisterdienst-Oktober.pdf",
  );
  await expect(page.getByTestId("upload-to-review")).toBeVisible();
  await shot(page, "p6-upload-layout-desktop");
});

test("p6-entity-edit-desktop", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/vehicle-list");
  await page.getByText("Octavia").first().click();
  await page.waitForURL(/vehicle-edit\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("render-edit-form-scroll")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await shot(page, "p6-entity-edit-desktop");
});
