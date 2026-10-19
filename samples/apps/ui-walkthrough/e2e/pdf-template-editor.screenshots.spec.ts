// @runtime test
// Screenshots of the PDF template editor for the design review. Runs only with
// SCREENSHOT_DIR set. Shows the seeded system template "Rechnung" (billing:invoice).
// The preview prints through the puppeteer service that playwright.config.ts starts.

import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
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

// No seeded template has a title this long, so the heading text is swapped in place: what is
// checked is how the header lays out a title that does not fit next to the actions.
test("a long template title truncates without sliding over the parent crumb", async ({ page }) => {
  await openEditor(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  const header = page.locator('[data-kumiko-layout="shell-header"]');
  await header.locator("h1").evaluate((heading) => {
    heading.textContent = "Kündigungsbestätigung des Betreibers für einen Vertrag mit Verlängerung";
  });
  const parentCrumb = header.getByRole("link", { name: "Vorlagen" });
  await expect(parentCrumb).toBeVisible();
  const crumbFits = await parentCrumb.evaluate(
    (element) => element.scrollWidth <= element.clientWidth,
  );
  expect(crumbFits).toBe(true);
  const crumbBox = await parentCrumb.boundingBox();
  const titleBox = await header.locator("h1").boundingBox();
  expect(crumbBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  if (crumbBox === null || titleBox === null) return;
  expect(crumbBox.x + crumbBox.width).toBeLessThanOrEqual(titleBox.x);
});

test("in a narrow window the parent crumb gives way to the title instead of running under the status", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 820 });
  // Not openEditor: at this width the title may truncate, which is the point here.
  await loginAs(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  await page.goto(EDITOR_URL);
  await expect(page.getByTestId("pdf-editor-footer-message")).toContainText("Pflicht-Platzhalter");
  const header = page.locator('[data-kumiko-layout="shell-header"]');
  await expect(header.getByRole("link", { name: "Vorlagen" })).toBeHidden();
  const crumbsFit = await header
    .locator("nav")
    .evaluate((nav) => (nav.firstElementChild?.scrollWidth ?? 0) <= nav.clientWidth);
  expect(crumbsFit).toBe(true);
  const titleBox = await header.locator("h1").boundingBox();
  const statusBox = await header.locator('[data-kumiko-layout="page-header-status"]').boundingBox();
  expect(titleBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  if (titleBox === null || statusBox === null) return;
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(statusBox.x);
  await shot(page, "pdf-template-editor-narrow-header");
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
