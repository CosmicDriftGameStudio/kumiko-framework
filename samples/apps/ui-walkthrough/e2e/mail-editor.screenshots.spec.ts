// @runtime test
// Screenshots of the mail editor for the design review. Runs only with
// SCREENSHOT_DIR set. Works on its own seeded draft "Korrigierte Rechnung" so
// the walk-through in mail-editor.spec.ts can change "Rechnung versendet"
// without altering what is shown here. No test mail is sent from this spec.

import { captureScreenshot } from "@cosmicdrift/kumiko-testing/e2e";
import { expect, type Page, test } from "@playwright/test";
import { TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD } from "../src/app/auth-constants";
import { loginAs } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1280, height: 820 } });
test.describe.configure({ mode: "serial" });

const EDITOR_URL = `/mail-editor?kind=mail&slug=${encodeURIComponent("billing:notify:invoice-corrected")}`;

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await captureScreenshot(page, name);
}

async function openEditor(page: Page): Promise<void> {
  await loginAs(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  await page.goto(EDITOR_URL);
  await expect(page.getByTestId("document-designer-editor-title")).toContainText(
    "Korrigierte Rechnung",
  );
  await expect(page.getByTestId("mail-placeholder-dueDate")).toHaveAttribute("data-bad", "true");
}

test("mail-editor-edit", async ({ page }) => {
  await openEditor(page);
  await page.getByTestId("mail-resource-upload-open").click();
  await page.setInputFiles("#mail-upload-image", "e2e/fixtures/logo-nordlicht.png");
  await expect(page.getByTestId("mail-resource-row")).toHaveCount(1);
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
  await shot(page, "mail-editor-edit-en-missing");
});
