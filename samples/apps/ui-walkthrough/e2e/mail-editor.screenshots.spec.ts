// @runtime test
// Screenshots of the mail editor for the design review. Runs only with
// SCREENSHOT_DIR set. Shows the seeded draft "Rechnung versendet" (Board 2/3);
// mail-editor.spec.ts walks its own draft "Korrigierte Rechnung", so nothing
// here depends on spec order. No test mail is sent from this spec.

import { captureScreenshot } from "@cosmicdrift/kumiko-testing/e2e";
import { expect, type Page, test } from "@playwright/test";
import { TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD } from "../src/app/auth-constants";
import { loginAs } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1280, height: 820 } });
test.describe.configure({ mode: "serial" });

const EDITOR_URL = `/mail-editor?kind=mail&slug=${encodeURIComponent("billing:notify:invoice-issued")}`;

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

async function openEditor(page: Page): Promise<void> {
  await loginAs(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  await page.goto(EDITOR_URL);
  await expect(page.locator('[data-kumiko-layout="shell-header"] h1')).toContainText(
    "Rechnung versendet",
  );
  await expect(page.getByTestId("mail-placeholder-dueDate")).toHaveAttribute("data-bad", "true");
}

test("mail-editor-edit", async ({ page }) => {
  await openEditor(page);
  // The seeded draft carries the invoice PDF as resource.
  await expect(page.getByTestId("mail-resource-row")).toHaveCount(1);
  await expectTitleFits(page);
  // The upload scrolled the left rail down; the shot shows it from its top, with one block selected.
  await page.evaluate(() => {
    for (const rail of document.querySelectorAll("aside")) rail.scrollTo(0, 0);
  });
  await page.locator("a[data-button]").first().click();
  await expect(page.getByTestId("document-block-options")).toBeVisible();
  await shot(page, "mail-editor-edit");
});

test("mail-editor-preview", async ({ page }) => {
  await openEditor(page);
  await page.getByTestId("mail-mode-switch").getByText("Vorschau", { exact: true }).click();
  await expect(page.getByTestId("mail-preview-iframe")).toBeVisible();
  await expect(page.getByTestId("mail-preview-checks")).toBeVisible();
  await shot(page, "mail-editor-preview");
});

test("mail-editor-edit-en-missing", async ({ page }) => {
  await openEditor(page);
  await page.getByTestId("mail-locale-switch").getByText("en", { exact: true }).click();
  await expect(page.getByTestId("mail-origin-bar")).toHaveAttribute("data-variant", "warn");
  await expectTitleFits(page);
  await shot(page, "mail-editor-edit-en-missing");
});
