// @runtime test
// Screenshots of the PDF template editor for the design review. Runs only with
// SCREENSHOT_DIR set. Shows the seeded system template "Rechnung" (billing:invoice).
// ui-walkthrough has no puppeteer service, so the preview state shows the
// "not available" notice instead of a rendered page.

import { captureScreenshot } from "@cosmicdrift/kumiko-testing/e2e";
import { expect, type Page, test } from "@playwright/test";
import {
  PLATFORM_ADMIN_EMAIL,
  PLATFORM_ADMIN_PASSWORD,
  TENANT_ADMIN_EMAIL,
  TENANT_ADMIN_PASSWORD,
} from "../src/app/auth-constants";
import { loginAs } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1280, height: 820 } });

const EDITOR_URL = `/pdf-template-editor?slug=${encodeURIComponent("billing:invoice")}&locale=de`;

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await captureScreenshot(page, name);
}

// The shell header gets the title only what the actions leave over: a clipped h1 is a layout bug.
async function expectTitleFits(page: Page): Promise<void> {
  const title = page.locator('[data-kumiko-layout="shell-header"] h1');
  await expect(title).toBeVisible();
  const fits = await title.evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(fits).toBe(true);
}

async function openEditor(page: Page, email: string, password: string): Promise<void> {
  await loginAs(page, email, password);
  await page.goto(EDITOR_URL);
  await expect(page.getByTestId("pdf-template-editor")).toBeVisible();
  await expect(page.locator('[data-kumiko-layout="shell-header"] h1')).toContainText("Rechnung");
  await expect(page.getByTestId("pdf-editor-footer-message")).toContainText("Pflicht-Platzhalter");
  await expectTitleFits(page);
  // Save and publish live in the footer only.
  await expect(page.getByTestId("document-designer-save")).toHaveCount(1);
  await expect(page.getByTestId("document-designer-publish")).toHaveCount(1);
}

test("pdf-template-editor-edit", async ({ page }) => {
  await openEditor(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  await page.locator("tr[data-each] td").first().click();
  const options = page.getByTestId("document-repeat-bar");
  await expect(options).toBeVisible();
  // The options sit on the table's frame, not at the caret or the top of the page.
  await expect
    .poll(async () => {
      const bar = await options.boundingBox();
      const table = await page.locator("table:has(tr[data-each])").first().boundingBox();
      if (bar === null || table === null) return false;
      return (
        Math.abs(bar.y + bar.height - table.y) < 40 &&
        bar.x + bar.width <= table.x + table.width + 4
      );
    })
    .toBe(true);
  await page
    .locator("table:has(tr[data-each])")
    .first()
    .evaluate((table) => {
      const scroller = table.closest(".overflow-auto");
      if (scroller !== null) scroller.scrollTop = 60;
    });
  await expect
    .poll(async () => {
      const bar = await options.boundingBox();
      const table = await page.locator("table:has(tr[data-each])").first().boundingBox();
      if (bar === null || table === null) return false;
      return Math.abs(bar.y + bar.height - table.y) < 40;
    })
    .toBe(true);
  await page
    .locator("table:has(tr[data-each])")
    .first()
    .evaluate((table) => {
      const scroller = table.closest(".overflow-auto");
      if (scroller !== null) scroller.scrollTop = 0;
    });
  await shot(page, "pdf-template-editor-edit");
});

test("pdf-template-editor-preview", async ({ page }) => {
  await openEditor(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  await page.getByTestId("pdf-mode-switch").getByText("Vorschau", { exact: true }).click();
  await expect(page.getByTestId("document-designer-pdf-preview")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("document-designer-preview-stale")).toHaveCount(0);
  await shot(page, "pdf-template-editor-preview");
});

test("pdf-template-editor-overrides", async ({ page }) => {
  await openEditor(page, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Anpassungen der Mandanten anzeigen" }).click();
  await expect(page.getByTestId("document-designer-overrides-drawer")).toBeVisible();
  await shot(page, "pdf-template-editor-overrides");
});
